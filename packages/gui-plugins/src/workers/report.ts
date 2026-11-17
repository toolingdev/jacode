import type { WorkerCheck, WorkerReport } from "./contract"

// The setup script's last line, added by the command that runs it, so its exit code survives ssh.
export const EXIT_MARKER = "JACODE_WORKER_EXIT="

// The script's mark for each check line, as the page names it.
const STATUS = { ok: "ok", note: "note", FAIL: "fail" } as const satisfies Record<string, WorkerCheck["status"]>

const STATUS_NAMES = ["ok", "note", "FAIL"] as const

/** The check lines the setup script printed, in order. Its other lines are progress and are left out. */
export function parseChecks(output: string): WorkerCheck[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^ {2}(ok|note|FAIL) {2,4}(.{18}) (.*)$/.exec(line)
    const status = STATUS_NAMES.find((name) => name === match?.[1])

    if (!match || !status) return []

    return [{ status: STATUS[status], name: (match[2] ?? "").trim(), detail: (match[3] ?? "").trim() }]
  })
}

/** What a run of the setup script came to: passed only when it finished with exit code 0. */
export function readReport(output: string): WorkerReport {
  const lines = output.split(/\r?\n/)
  const exit = lines.findLast((line) => line.startsWith(EXIT_MARKER))?.slice(EXIT_MARKER.length)

  return {
    passed: exit === "0",
    checks: parseChecks(output),
    output: lines
      .filter((line) => !line.startsWith(EXIT_MARKER))
      .slice(-60)
      .join("\n")
      .trim(),
  }
}

/** The server binary's file name for what `uname -m` printed; undefined for a processor a worker does not run on. */
export function binaryName(machine: string) {
  const name = machine.trim()

  if (name === "x86_64" || name === "amd64") return "opencode-linux-x64"

  if (name === "aarch64" || name === "arm64") return "opencode-linux-arm64"

  return undefined
}
