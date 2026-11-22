export * as ComputerTool from "./computer.js"

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { toolFailure } from "../runtime.js"
import driver from "./computer.jxa" with { type: "text" }

// Fork feature: the model sees and works this Mac's screen. It takes screenshots of the main display and moves the
// mouse, clicks, drags, scrolls, types and presses keys, through macOS's own scripting host, so nothing extra is
// installed. The tool is off in every chat until the user switches it on there (the chat then carries an `ask` rule
// for `computer` over the default `deny`), and every action asks the user first unless they allowed that kind of
// action always. macOS asks once for Screen Recording and Accessibility for the app.

export const name = "computer"

/** The permission action every screen action is asked under; a chat rule for it switches the tool on or off. */
export const permission = "computer"

// Screenshots are scaled so the long edge stays within what vision models read without shrinking them again.
const LONG_EDGE = 1456
// How long the screen gets to settle before the screenshot an action returns.
const SETTLE_MS = 600

const Point = Schema.Finite.annotate({ description: "In screenshot pixels, as the latest screenshot shows them." })

export const Input = Schema.Struct({
  action: Schema.Literals(["screenshot", "click", "move", "drag", "scroll", "type", "key"]).annotate({
    description:
      "screenshot: see the screen. click / move: at x, y. drag: from x, y to toX, toY. scroll: at x, y by down and right lines. type: text. key: a key with modifiers.",
  }),
  x: Schema.optionalKey(Point),
  y: Schema.optionalKey(Point),
  toX: Schema.optionalKey(Point),
  toY: Schema.optionalKey(Point),
  button: Schema.optionalKey(Schema.Literals(["left", "right"])),
  count: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })).annotate({
      description: "Clicks: 2 for a double click, 3 for a triple click.",
    }),
  ),
  down: Schema.optionalKey(Schema.Int.annotate({ description: "Lines to scroll down; negative scrolls up." })),
  right: Schema.optionalKey(Schema.Int.annotate({ description: "Lines to scroll right; negative scrolls left." })),
  text: Schema.optionalKey(Schema.String.annotate({ description: "Text to type, as if on the keyboard." })),
  keys: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'One key, with modifiers joined by "+": "return", "escape", "tab", "cmd+c", "cmd+shift+t", "down", "f5".',
    }),
  ),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  action: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
})

export const description = `Look at and work this Mac's screen like a person would: take a screenshot of the main display, then click, double-click, drag, scroll, type and press keys. Coordinates are pixels in the latest screenshot. Every action returns a fresh screenshot, so check it before the next step. Prefer other tools (files, shell, web) when they can do the job; use this one for apps that only have a screen. Ask the user before anything that sends, buys, deletes or signs in, and never type passwords.`

export const Plugin = {
  id: "opencode.tool.computer",
  effect: Effect.fn("ComputerTool.Plugin")(function* (ctx: Context) {
    if (process.platform !== "darwin") return
    if (!(yield* Flag.enabled("computer_use"))) return
    const permissions = yield* Permission.Service

    // Off until a chat switches it on: every agent ends with the tool denied, after any rule that allows everything,
    // and only a chat's own rule, which comes after the agent's, lets it back in.
    yield* ctx.agent.transform((editor) =>
      editor.list().forEach((agent) =>
        editor.update(agent.id, (item) => {
          item.permissions.push({ action: permission, resource: "*", effect: "deny" })
        }),
      ),
    )

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        description,
        input: Input,
        output: Output,
        options: { permission, codemode: false },
        execute: (input, context) =>
          Effect.gen(function* () {
            const step = yield* Effect.try({
              try: () => plan(input),
              catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
            })

            const session = yield* ctx.session.get({ sessionID: context.sessionID })

            // A rule that allows everything must not reach the screen: only a chat switched on may use it.
            if (!switchedOn(session.permissions))
              return yield* new ToolFailure({
                message: "Mac control is off in this chat. The user can switch it on with the Mac control pill above the composer.",
              })

            yield* permissions.assert({
              action: permission,
              resources: [input.action],
              save: [input.action],
              metadata: { input: describe(input) },
              ...Permission.invocation(context),
            })

            return yield* Effect.tryPromise({
              try: async () => {
                const screen = await size()
                const scale = Math.min(1, LONG_EDGE / Math.max(screen.width, screen.height))

                if (step) {
                  // Screenshot pixels back to screen points.
                  const points = Object.fromEntries(
                    Object.entries(step).map(([key, value]) =>
                      ["x", "y", "toX", "toY"].includes(key) && typeof value === "number"
                        ? [key, value / scale]
                        : [key, value],
                    ),
                  )
                  const answer = await drive(points)

                  if (answer.error === "accessibility") throw new Error(ACCESSIBILITY)
                  await Bun.sleep(SETTLE_MS)
                }
                const width = Math.round(screen.width * scale)
                const height = Math.round(screen.height * scale)
                const image = await screenshot(width, height)

                return {
                  output: { action: input.action, width, height },
                  content: [
                    {
                      type: "text" as const,
                      text: `${step ? `Done: ${input.action}. ` : ""}Screenshot of the main display, ${width}x${height} pixels; use these pixels for coordinates.`,
                    },
                    {
                      type: "file" as const,
                      uri: `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`,
                      mime: "image/jpeg",
                      name: "screen.jpg",
                    },
                  ],
                }
              },
              catch: (error) =>
                new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
            })
          }).pipe(Effect.mapError(toolFailure("The screen action was not done"))),
      }),
    )
  }),
}

/** The driver command for an action, checked for the fields it needs; undefined for a screenshot alone. */
export function plan(input: Input) {
  const at = () => {
    if (input.x === undefined || input.y === undefined) throw new Error(`${input.action} needs x and y`)
    return { x: input.x, y: input.y }
  }

  if (input.action === "screenshot") return undefined
  if (input.action === "click") return { action: "click", ...at(), button: input.button ?? "left", count: input.count ?? 1 }
  if (input.action === "move") return { action: "move", ...at() }
  if (input.action === "scroll") return { action: "scroll", ...at(), down: input.down ?? 0, right: input.right ?? 0 }
  if (input.action === "drag") {
    if (input.toX === undefined || input.toY === undefined) throw new Error("drag needs toX and toY")
    return { action: "drag", ...at(), toX: input.toX, toY: input.toY }
  }
  if (input.action === "type") {
    if (!input.text) throw new Error("type needs text")
    return { action: "type", text: input.text }
  }
  if (!input.keys?.trim()) throw new Error("key needs keys")
  return { action: "key", keys: input.keys }
}

/** Whether a chat's own rules switch the tool on: the `ask` rule the Mac control pill adds. */
export function switchedOn(rules: readonly { readonly action: string; readonly resource: string; readonly effect: string }[] | undefined) {
  return (rules ?? []).some((rule) => rule.action === permission && rule.resource === "*" && rule.effect === "ask")
}

/** What the user approves, without fields the action does not use. */
function describe(input: Input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

const ACCESSIBILITY =
  "macOS has not allowed JaCode to control the mouse and keyboard. Ask the user to turn JaCode on in System Settings › Privacy & Security › Accessibility, then try again."
const SCREEN_RECORDING =
  "macOS has not allowed JaCode to record the screen. Ask the user to turn JaCode on in System Settings › Privacy & Security › Screen & System Audio Recording, then quit and reopen JaCode."

async function drive(command: unknown): Promise<{ readonly error?: string; readonly width?: number; readonly height?: number }> {
  const process = Bun.spawn(["/usr/bin/osascript", "-l", "JavaScript", "-", JSON.stringify(command)], {
    stdin: new TextEncoder().encode(driver),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  if (code !== 0) throw new Error(err.trim().replace(/^execution error: /, "") || `The screen driver stopped with ${code}`)

  return JSON.parse(out)
}

async function size() {
  const answer = await drive({ action: "size" })

  return { width: answer.width ?? 0, height: answer.height ?? 0 }
}

async function screenshot(width: number, height: number) {
  const dir = await mkdtemp(path.join(tmpdir(), "jacode-screen-"))
  const raw = path.join(dir, "raw.png")
  const out = path.join(dir, "screen.jpg")

  try {
    // -x silent, -m main display only, -C with the pointer, so the model sees where it is.
    const capture = Bun.spawnSync(["/usr/sbin/screencapture", "-x", "-m", "-C", "-t", "png", raw], { stderr: "pipe" })

    if (capture.exitCode !== 0) throw new Error(SCREEN_RECORDING)
    const resize = Bun.spawnSync(
      ["/usr/bin/sips", "-z", String(height), String(width), "-s", "format", "jpeg", "-s", "formatOptions", "75", raw, "--out", out],
      { stdout: "ignore", stderr: "pipe" },
    )

    if (resize.exitCode !== 0) throw new Error(`Could not scale the screenshot: ${resize.stderr.toString().trim()}`)

    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
