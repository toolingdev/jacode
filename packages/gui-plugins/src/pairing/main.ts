import { execFile } from "node:child_process"
import { powerSaveBlocker } from "electron"
import { Schema } from "effect"
import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import { AccessStatus, Pairing } from "./contract"
import { createDispatch } from "./dispatch"
import {
  createPairingMainState,
  pairingMainEffectFailed,
  selectBlocker,
  transitionPairingMain,
  type PairingMainEffect,
  type ServiceRequest,
} from "./main-machine"

type Waiter = { resolve: (value: boolean | undefined) => void; reject: (error: Error) => void }

const setup: Plugin.MainSetup = (ctx) => {
  // Whether main keeps the display awake; stored before in the desktop's own settings namespace.
  const stored = builtinMainContext(ctx).storage.store("keepScreenActive", {
    schema: Schema.Boolean,
    initial: false,
    from: { state: ["opencode.settings", "keepScreenActive"] },
  })

  const cli = ctx.cli
  const log = ctx.log
  const current = { state: createPairingMainState(), waiter: 0 }
  // Each running command's abort controller, and each caller waiting on a command.
  const commands = new Map<number, AbortController>()
  const waiters = new Map<number, Waiter>()

  const dispatch = createDispatch({
    read: () => current.state,
    write: (state) => {
      current.state = state
    },
    transition: transitionPairingMain,
    run: (effect: PairingMainEffect) => run(effect),
    failed: pairingMainEffectFailed,
  })

  // The OS can drop the blocker, so whether main holds it is asked each time.
  const screenActive = () => {
    const id = selectBlocker(current.state)

    return id !== undefined && powerSaveBlocker.isStarted(id)
  }

  const run = (effect: PairingMainEffect) => {
    if (effect.type === "blocker.start")
      return dispatch({ type: "blocker.started", id: powerSaveBlocker.start("prevent-display-sleep") })

    if (effect.type === "blocker.stop") {
      if (powerSaveBlocker.isStarted(effect.id)) powerSaveBlocker.stop(effect.id)

      return
    }

    if (effect.type === "persist.screen") return stored.set(effect.enabled)

    if (effect.type === "service.abort") {
      commands.get(effect.attempt)?.abort()
      commands.delete(effect.attempt)

      return
    }

    if (effect.type === "waiter.resolve" || effect.type === "waiter.reject") {
      const waiter = waiters.get(effect.waiter)

      waiters.delete(effect.waiter)

      if (effect.type === "waiter.resolve") return waiter?.resolve(effect.value)

      return waiter?.reject(new Error(effect.message))
    }

    // Remote access is a setting of the background service, so it changes through the CLI the app runs, as with
    // `opencode pair --remote`. A hung command ends at its timeout, so the next one always runs.
    const attempt = effect.attempt
    const controller = new AbortController()

    commands.set(attempt, controller)
    execFile(
      cli.command[0] ?? "opencode",
      [...cli.command.slice(1), "service", ...effect.args],
      { signal: AbortSignal.any([ctx.signal, controller.signal]), timeout: effect.timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        commands.delete(attempt)

        if (!error) return dispatch({ type: "service.succeeded", attempt, stdout: stdout.trim() })
        log.write("error", "pairing service command failed", { args: effect.args, error: error.message, stderr })
        dispatch({ type: "service.failed", attempt, message: error.message })
      },
    )
  }

  // Queues a command. A read stops when its caller goes away; a change goes on.
  const service = (request: ServiceRequest, signal?: AbortSignal) => {
    current.waiter += 1
    const waiter = current.waiter
    const cancel = () => dispatch({ type: "waiter.cancelled", waiter })

    return new Promise<boolean | undefined>((resolve, reject) => {
      waiters.set(waiter, { resolve, reject })
      signal?.addEventListener("abort", cancel, { once: true })
      dispatch({ type: "service.requested", waiter, request })

      if (signal?.aborted) cancel()
    }).finally(() => signal?.removeEventListener("abort", cancel))
  }

  // Fork feature: the ways in. Changes run one at a time, since each one restarts the background service.
  const access = { queue: Promise.resolve() }
  const decodeAccess = Schema.decodeUnknownPromise(Schema.fromJsonString(AccessStatus))

  const accessCommand = (args: readonly string[], timeout: number, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        cli.command[0] ?? "opencode",
        [...cli.command.slice(1), "service", ...args],
        {
          signal: AbortSignal.any([ctx.signal, ...(signal ? [signal] : [])]),
          timeout,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout.trim())
          log.write("error", "remote access command failed", { args, error: error.message, stderr })
          reject(new Error(stderr.trim().split("\n").at(-1) || error.message))
        },
      )
    })

  if (stored.value) dispatch({ type: "screen.set", enabled: true, started: false })
  ctx.onCleanup(() => dispatch({ type: "disposed" }))

  ctx.provide(Pairing, {
    remote: async (_, caller) => (await service({ kind: "get-remote" }, caller.signal)) === true,
    // Changing the setting stops the service, and starting it again brings it back. A window that closes meanwhile
    // does not cancel the change.
    setRemote: async (enabled) => {
      await service({ kind: "set-remote", enabled })
    },
    screenActive,
    setScreenActive: (enabled) => dispatch({ type: "screen.set", enabled, started: screenActive() }),
    access: async (_, caller) => decodeAccess(await accessCommand(["get", "access-status"], 15_000, caller.signal)),
    // Turning a way on can create the OpenTunnel tunnel, which can take a few minutes.
    setAccess: (input) => {
      const next = access.queue.then(() => accessCommand(["set", "access", JSON.stringify(input)], 300_000))

      access.queue = next.then(
        () => undefined,
        () => undefined,
      )

      return next.then(() => undefined)
    },
  })
}

export default setup
