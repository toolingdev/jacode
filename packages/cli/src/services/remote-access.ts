export * as RemoteAccess from "./remote-access"

import { execFile } from "node:child_process"
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { Effect, Option, Schedule, Schema } from "effect"

// Fork feature: remote access through more than OpenTunnel. The user turns ways in (Tailscale, Tailscale Funnel,
// OpenTunnel, the local network, an address of their own) on in Settings and puts them in order. The service runs
// every one that is on, checks each address, and writes what it found to a status file, so the app shows which
// ways work and pairing hands out the addresses in the user's order.

/** One way another device can reach this computer. */
export const Method = Schema.Literals(["tailscale", "funnel", "opentunnel", "lan", "custom"])
export type Method = typeof Method.Type

/** The order a fresh setup uses: private ways first, the local network last because it only works at home. */
export const DEFAULT_ORDER: readonly Method[] = ["tailscale", "opentunnel", "funnel", "lan", "custom"]

/** The service's stored choices. OpenTunnel's own switch stays the upstream `remote` setting. */
export const Config = Schema.Struct({
  order: Schema.optional(Schema.Array(Method)),
  tailscale: Schema.optional(Schema.Boolean),
  funnel: Schema.optional(Schema.Boolean),
  lan: Schema.optional(Schema.Boolean),
  custom: Schema.optional(Schema.String),
  // The Remote access switch turned off: every way stays chosen but none runs.
  paused: Schema.optional(Schema.Boolean),
})
export type Config = typeof Config.Type

/** What `service set access` takes: the stored choices plus OpenTunnel's switch. */
export const Input = Schema.Struct({ ...Config.fields, opentunnel: Schema.optional(Schema.Boolean) })
export type Input = typeof Input.Type

export const State = Schema.Literals(["off", "starting", "ready", "failed"])
export type State = typeof State.Type

export const Entry = Schema.Struct({
  method: Method,
  state: State,
  url: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
export type Entry = typeof Entry.Type

export const Status = Schema.Struct({ pid: Schema.Number, entries: Schema.Array(Entry) })
export type Status = typeof Status.Type

// Tailscale serves the tailnet address and the Funnel address on ports of their own, so neither replaces a serve
// setting the user made on 443. Funnel only allows 443, 8443 and 10000.
const TAILSCALE_PORT = 8443
const FUNNEL_PORT = 10_000
const CHECK_EVERY = "60 seconds"

/** Every method in the user's order: their order first, then any method it leaves out. */
export function order(config: Config | undefined) {
  const chosen = (config?.order ?? []).filter((method, index, all) => all.indexOf(method) === index)

  return [...chosen, ...DEFAULT_ORDER.filter((method) => !chosen.includes(method))]
}

/** Whether a method is on: OpenTunnel by the upstream `remote` setting, the others by their own switch. */
export function enabled(method: Method, config: Config | undefined, opentunnel: boolean) {
  if (config?.paused) return false

  if (method === "opentunnel") return opentunnel

  if (method === "custom") return !!config?.custom

  return config?.[method] === true
}

/** Whether any way in is on, which is what the Remote access switch shows. */
export function anyEnabled(config: Config | undefined, opentunnel: boolean) {
  return order(config).some((method) => enabled(method, config, opentunnel))
}

/**
 * The live state of every method for one service run. The server reads `urls` for the addresses it advertises, the
 * tunnel reports its address with `set`, and each change rewrites the status file.
 */
export function board(input: { config: Config | undefined; opentunnel: boolean; file: string }) {
  const entries = new Map<Method, Entry>(
    order(input.config).map((method) => [
      method,
      { method, state: enabled(method, input.config, input.opentunnel) ? "starting" : "off" },
    ]),
  )

  const list = () => order(input.config).flatMap((method) => entries.get(method) ?? [])

  const write = () => {
    const temp = `${input.file}.${process.pid}.tmp`
    const status: Status = { pid: process.pid, entries: list() }

    writeFileSync(temp, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 })
    renameSync(temp, input.file)
  }

  write()

  const set = (method: Method, next: Omit<Entry, "method">) => {
    if (entries.get(method)?.state === "off") return
    entries.set(method, { method, ...next })
    write()
  }

  // Asks an address whether this server answers there. A 401 is an answer: the server is reachable and only wants
  // the pairing credential. A result for an address that has since changed is dropped.
  const probe = async (method: Method) => {
    const url = entries.get(method)?.url

    if (!url) return

    const answered = await fetch(`${url}/api/info`, { signal: AbortSignal.timeout(8_000) }).then(
      (response) => response.status === 200 || response.status === 401,
      () => false,
    )

    if (entries.get(method)?.url !== url) return
    set(method, { state: answered ? "ready" : "failed", url, message: answered ? undefined : `${UNREACHABLE} ${url}` })
  }

  return {
    config: input.config,
    on: (method: Method) => entries.get(method)?.state !== "off",
    get: (method: Method) => entries.get(method),
    /** Records a method's state; a new address is checked at once. */
    set: (method: Method, next: Omit<Entry, "method">) => {
      set(method, next)

      if (next.state === "starting" && next.url) void probe(method)
    },
    /** Checks every address again, except those that failed before they had one to check. */
    check: () =>
      Promise.all(
        list().flatMap((entry) =>
          entry.url && (entry.state === "ready" || entry.state === "starting" || entry.message?.startsWith(UNREACHABLE))
            ? [probe(entry.method)]
            : [],
        ),
      ),
    /** Working addresses in the user's order. */
    urls: () => list().flatMap((entry) => (entry.state === "ready" && entry.url ? [entry.url] : [])),
    entries: list,
  }
}

export type Board = ReturnType<typeof board>

/**
 * Runs every way in that is on, other than OpenTunnel, which the server starts itself: Tailscale and Funnel through
 * `tailscale serve`, the local network through the bound address, and the user's own address as given. Then checks
 * each address once a minute, OpenTunnel's included.
 */
export const run = Effect.fnUntraced(function* (input: { board: Board; port: number; bound: string }) {
  const board = input.board
  const target = `http://127.0.0.1:${input.port}`

  if (board.on("lan")) board.set("lan", lan(input.bound, input.port))

  if (board.on("custom") && board.config?.custom)
    board.set("custom", { state: "starting", url: board.config.custom.replace(/\/+$/, "") })

  if (board.on("tailscale")) board.set("tailscale", yield* serve("serve", TAILSCALE_PORT, target))

  if (board.on("funnel")) board.set("funnel", yield* serve("funnel", FUNNEL_PORT, target))

  // Turns the serve settings off again when the service stops, so a stopped JaCode leaves nothing reachable.
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      if (board.get("tailscale")?.url) await tailscale(["serve", `--https=${TAILSCALE_PORT}`, "off"], 15_000)

      if (board.get("funnel")?.url) await tailscale(["funnel", `--https=${FUNNEL_PORT}`, "off"], 15_000)
    }),
  )

  yield* Effect.promise(() => board.check()).pipe(
    Effect.repeat({ schedule: Schedule.spaced(CHECK_EVERY) }),
    Effect.delay(CHECK_EVERY),
  )
})

const UNREACHABLE = "Not reachable from this computer at"

// The local network address: the first private IPv4 address of an interface that is not Tailscale's.
function lan(bound: string, port: number): Omit<Entry, "method"> {
  if (bound !== "0.0.0.0" && bound !== "::")
    return {
      state: "failed",
      message: `The service listens only on ${bound}. Clear the hostname setting so it can listen on the local network.`,
    }

  const address = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === "IPv4" && !entry.internal && privateAddress(entry.address))?.address

  if (!address) return { state: "failed", message: "This computer has no local network address right now." }

  return { state: "starting", url: `http://${address}:${port}` }
}

function privateAddress(address: string) {
  const [a = 0, b = 0] = address.split(".").map(Number)

  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

const TailscaleStatus = Schema.Struct({
  BackendState: Schema.String,
  Self: Schema.optional(Schema.Struct({ DNSName: Schema.optional(Schema.String) })),
})
const decodeTailscaleStatus = Schema.decodeUnknownOption(Schema.fromJsonString(TailscaleStatus))

const ServeStatus = Schema.Struct({
  Web: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        Handlers: Schema.optional(
          Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optional(Schema.String) })),
        ),
      }),
    ),
  ),
})
const decodeServeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(ServeStatus))

// Serves the local server over HTTPS on the tailnet (`serve`) or on the internet (`funnel`), on a port of its own.
const serve = (kind: "serve" | "funnel", port: number, target: string) =>
  Effect.promise(async (): Promise<Omit<Entry, "method">> => {
    const status = await tailscale(["status", "--json"], 10_000)

    if (status.missing) return { state: "failed", message: "Tailscale is not installed on this computer." }

    const parsed = Option.getOrUndefined(decodeTailscaleStatus(status.stdout))

    if (parsed?.BackendState !== "Running")
      return { state: "failed", message: "Tailscale is not running or not signed in on this computer." }

    const host = parsed.Self?.DNSName?.replace(/\.$/, "")

    if (!host) return { state: "failed", message: "Tailscale did not report this computer's name. Turn on MagicDNS." }

    // A serve setting the user made on this port stays; JaCode only replaces its own.
    const current = Option.getOrUndefined(decodeServeStatus((await tailscale(["serve", "status", "--json"], 10_000)).stdout))
    const existing = current?.Web?.[`${host}:${port}`]?.Handlers?.["/"]?.Proxy

    if (existing !== undefined && existing !== target)
      return {
        state: "failed",
        message: `Port ${port} is already used by another Tailscale serve setting on this computer.`,
      }

    const result = await tailscale([kind, "--bg", `--https=${port}`, target], 30_000)

    if (result.code !== 0) return { state: "failed", message: tailscaleError(kind, result.stderr || result.stdout) }

    return { state: "starting", url: `https://${host}:${port}` }
  })

function tailscaleError(kind: "serve" | "funnel", output: string) {
  if (/https/i.test(output) && /(enable|certificate|cert)/i.test(output))
    return "Turn on HTTPS certificates for your tailnet in the Tailscale admin console (DNS page), then try again."

  if (kind === "funnel" && /funnel/i.test(output) && /(not|enable|allow|attr)/i.test(output))
    return "Funnel is not allowed for this device. Allow it in your tailnet's access controls, then try again."

  if (/access denied|permission|operator/i.test(output))
    return "Tailscale refused the change. On Linux, run `sudo tailscale set --operator=$USER` once."

  return output.trim().split("\n")[0] || `tailscale ${kind} failed.`
}

// The Tailscale command line: on the PATH, from Homebrew, or inside the Mac app, which the service's PATH can miss.
function tailscaleCommand() {
  return (
    [
      process.env.TAILSCALE_CLI,
      "/usr/local/bin/tailscale",
      "/opt/homebrew/bin/tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/usr/bin/tailscale",
    ].find((candidate) => candidate && existsSync(candidate)) ?? "tailscale"
  )
}

function tailscale(args: readonly string[], timeout: number) {
  return new Promise<{ code: number; stdout: string; stderr: string; missing: boolean }>((resolve) => {
    execFile(tailscaleCommand(), args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

      resolve({ code, stdout, stderr, missing: error?.code === "ENOENT" })
    })
  })
}
