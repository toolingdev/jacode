import { readFile } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import type { Plugin } from "@opencode/plugin/gui/main"
import { Workers, type WorkerReport, type WorkerRequest } from "./contract"
import { binaryName, EXIT_MARKER, readReport } from "./report"
import script from "./setup.sh?raw"
import { parseAddress, runOn, SshError } from "./ssh"

/**
 * Fork feature: the main-process half of the Workers settings page. It runs the worker setup script on a remote
 * machine over ssh: once to check the machine, and once more to install. The script and the server binary travel
 * over the same ssh connection, so the machine needs nothing but an ssh login.
 *
 * The worker listens on its own machine only (127.0.0.1); the app then reaches it through the SSH plugin's tunnel,
 * so no port is opened to a network and no password is typed.
 */
const setup: Plugin.MainSetup = (ctx) => {
  // The server binaries the app's install put beside it, one per processor, built from the same version as the app.
  const binaries = path.join(app.getPath("userData"), "worker", ctx.cli.version)

  const failed = (failure: NonNullable<WorkerReport["failure"]>, output = ""): WorkerReport => ({
    passed: false,
    checks: [],
    output,
    failure,
  })

  const run = async (request: WorkerRequest, mode: "check" | "install") => {
    const address = parseAddress(request.target)

    if (mode === "install") {
      const name = binaryName(await runOn({ address, command: "uname -m", timeout: 30_000 }))
      const binary = name ? await readFile(path.join(binaries, name)).catch(() => undefined) : undefined

      if (!binary) return failed("binary", name ?? "")

      await runOn({
        address,
        command: "cat > /tmp/opencode.new && chmod 755 /tmp/opencode.new",
        stdin: binary,
        timeout: 20 * 60_000,
      })
    }

    const settings = [`WORKER_MODE=${mode}`, `WORKER_BROWSER=${request.browser}`, "WORKER_LISTEN=127.0.0.1"]

    // The script goes to a file first: run straight from stdin, a command inside it could swallow the rest of it.
    // A check finds no new binary yet; the path it is given exists, so that check line passes as it will later.
    const remote = [
      'f="$(mktemp)" && cat > "$f"',
      `env ${settings.join(" ")}${mode === "check" ? ' WORKER_BINARY="$f"' : ""} bash "$f" </dev/null 2>&1`,
      `echo "${EXIT_MARKER}$?"`,
      'rm -f "$f"',
    ].join("; ")

    return readReport(
      await runOn({
        address,
        command: `sh -c '${remote.replaceAll("'", "'\\''")}'`,
        stdin: script,
        timeout: 20 * 60_000,
      }),
    )
  }

  const report = (request: WorkerRequest, mode: "check" | "install") =>
    run(request, mode).catch((error: Error) =>
      error instanceof SshError ? failed(error.problem, error.message) : failed("connection", error.message),
    )

  ctx.provide(Workers, {
    check: (request) => report(request, "check"),
    install: (request) => report(request, "install"),
  })
}

export default setup
