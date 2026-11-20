import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { RemoteAccess } from "../src/services/remote-access"

describe("RemoteAccess", () => {
  test("keeps the user's order and appends the methods it leaves out", () => {
    expect(RemoteAccess.order({ order: ["lan", "opentunnel", "lan"] })).toEqual([
      "lan",
      "opentunnel",
      "tailscale",
      "funnel",
      "custom",
    ])
    expect(RemoteAccess.order(undefined)).toEqual([...RemoteAccess.DEFAULT_ORDER])
  })

  test("reads OpenTunnel from the remote setting and pauses every method together", () => {
    expect(RemoteAccess.enabled("opentunnel", undefined, true)).toBe(true)
    expect(RemoteAccess.enabled("custom", { custom: "https://example.test" }, false)).toBe(true)
    expect(RemoteAccess.enabled("tailscale", { tailscale: true, paused: true }, false)).toBe(false)
    expect(RemoteAccess.anyEnabled({ lan: true, paused: true }, true)).toBe(false)
    expect(RemoteAccess.anyEnabled({ lan: true }, false)).toBe(true)
    expect(RemoteAccess.anyEnabled({}, false)).toBe(false)
  })

  test("advertises working addresses in the user's order and writes the status file", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "remote-access-")), "status.json")
    const board = RemoteAccess.board({
      config: { order: ["lan", "tailscale"], lan: true, tailscale: true },
      opentunnel: true,
      file,
    })

    board.set("opentunnel", { state: "ready", url: "https://tunnel.example" })
    board.set("tailscale", { state: "ready", url: "https://mac.tail.example:8443" })
    board.set("lan", { state: "failed", message: "No local network address" })
    // A method that is off stays off.
    board.set("funnel", { state: "ready", url: "https://mac.tail.example:10000" })

    expect(board.urls()).toEqual(["https://mac.tail.example:8443", "https://tunnel.example"])
    const status = JSON.parse(readFileSync(file, "utf8"))
    expect(status.pid).toBe(process.pid)
    expect(status.entries.map((entry: { method: string; state: string }) => [entry.method, entry.state])).toEqual([
      ["lan", "failed"],
      ["tailscale", "ready"],
      ["opentunnel", "ready"],
      ["funnel", "off"],
      ["custom", "off"],
    ])
  })
})
