import { describe, expect, test } from "bun:test"
import { isOff, offRule, withServer } from "./chat-tools"

describe("chat tools", () => {
  test("names a server's tools the way the server does", () => {
    expect(offRule("my.calendar server").action).toBe("my_calendar_server_*")
  })

  test("switches a server off and on again, keeping the chat's other rules", () => {
    const other = { action: "bash", resource: "*", effect: "ask" as const }
    const off = withServer([other], "calendar", false)

    expect(isOff(off, "calendar")).toBe(true)
    expect(isOff(off, "database")).toBe(false)
    expect(withServer(off, "calendar", true)).toEqual([other])
    expect(withServer(off, "calendar", false)).toEqual(off)
  })
})
