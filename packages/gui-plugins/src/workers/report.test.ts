import { describe, expect, test } from "bun:test"
import { binaryName, EXIT_MARKER, parseChecks, readReport } from "./report"

const output = [
  "Checking box for a worker (as me, listening on 127.0.0.1:4096)",
  "  ok    system             Linux",
  "  ok    memory             7947 MB",
  "  note  browser            skipped: turned off",
  "  FAIL  port 4096          taken by something else; pick another with WORKER_PORT",
  "Not set up: fix the lines marked FAIL and run this again. Nothing was changed.",
  `${EXIT_MARKER}1`,
  "",
].join("\n")

describe("worker setup report", () => {
  test("reads each check line the script printed, and nothing else", () => {
    expect(parseChecks(output)).toEqual([
      { status: "ok", name: "system", detail: "Linux" },
      { status: "ok", name: "memory", detail: "7947 MB" },
      { status: "note", name: "browser", detail: "skipped: turned off" },
      { status: "fail", name: "port 4096", detail: "taken by something else; pick another with WORKER_PORT" },
    ])
  })

  test("passes only when the script exited with 0", () => {
    expect(readReport(output).passed).toBe(false)
    expect(readReport(output.replace(`${EXIT_MARKER}1`, `${EXIT_MARKER}0`)).passed).toBe(true)
    // A connection cut before the script finished leaves no exit line.
    expect(readReport("  ok    system             Linux\n").passed).toBe(false)
  })

  test("keeps the script's words for the details view, without the exit line", () => {
    expect(readReport(output).output).toContain("Nothing was changed.")
    expect(readReport(output).output).not.toContain(EXIT_MARKER)
  })

  test("names the server binary for a machine's processor", () => {
    expect(binaryName("x86_64\n")).toBe("opencode-linux-x64")
    expect(binaryName("aarch64")).toBe("opencode-linux-arm64")
    expect(binaryName("riscv64")).toBeUndefined()
  })
})
