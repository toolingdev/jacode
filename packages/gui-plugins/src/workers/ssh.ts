import { spawn } from "node:child_process"

/** Why a command could not be run on the machine at all. */
export type SshProblem = "input" | "connection" | "ssh-missing"

export class SshError extends Error {
  constructor(
    readonly problem: SshProblem,
    detail = "",
  ) {
    super(detail)
  }
}

/**
 * Where a machine is, read from what the user typed: `user@host`, optionally led by `ssh` and with a port (`-p`)
 * or a key file (`-i`). Nothing else is taken, so what is typed can only ever name a machine, never a command.
 * The SSH plugin, which connects to the worker afterwards, reads the same text and accepts all of this.
 */
export function parseAddress(input: string) {
  const words = input.trim().split(/\s+/).filter(Boolean)
  const rest = words[0] === "ssh" ? words.slice(1) : words

  const read = (
    left: readonly string[],
    options: readonly string[],
    hosts: readonly string[],
  ): string[] | undefined => {
    const [word, value, ...after] = left

    if (word === undefined) return hosts.length === 1 ? [...options, ...hosts] : undefined

    if (word === "-p" || word === "-i") return value ? read(after, [...options, word, value], hosts) : undefined

    if (!/^[A-Za-z0-9._@:[\]-]+$/.test(word) || word.startsWith("-")) return undefined

    return read(left.slice(1), options, [...hosts, word])
  }

  const args = read(rest, [], [])

  if (!args) throw new SshError("input")

  return args
}

/**
 * Runs one command on the machine and gives back what it printed. It never waits on a password prompt nobody can
 * see: a machine that asks for one is reported as unreachable. `stdin` is sent and then closed.
 */
export function runOn(input: {
  address: readonly string[]
  command: string
  stdin?: string | Uint8Array
  timeout: number
}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "ssh.exe" : "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        // A machine met for the first time is remembered; one whose identity has changed since is still refused.
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        ...input.address,
        input.command,
      ],
      { stdio: ["pipe", "pipe", "pipe"], timeout: input.timeout },
    )

    const printed = { out: "", err: "" }

    // The tail is what matters, and a long install must not grow without bound.
    child.stdout.on("data", (chunk: Buffer) => (printed.out = (printed.out + chunk.toString()).slice(-1_000_000)))
    child.stderr.on("data", (chunk: Buffer) => (printed.err = (printed.err + chunk.toString()).slice(-4_000)))
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(new SshError(error.code === "ENOENT" ? "ssh-missing" : "connection", error.message)),
    )
    child.on("close", (code) =>
      code === 0
        ? resolve(printed.out)
        : reject(new SshError("connection", printed.err.trim() || `ssh exited with ${code}`)),
    )
    // A machine that hangs up early closes the pipe under the write; the close event reports that.
    child.stdin.on("error", () => undefined)
    child.stdin.end(input.stdin ?? "")
  })
}
