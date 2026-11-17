import { describe, expect, test } from "bun:test"
import { parseAddress, SshError } from "./ssh"

describe("worker ssh address", () => {
  test("takes a machine, with or without ssh in front, a port and a key file", () => {
    expect(parseAddress("me@box")).toEqual(["me@box"])
    expect(parseAddress("  ssh root@203.0.113.7 -p 2222 ")).toEqual(["-p", "2222", "root@203.0.113.7"])
    expect(parseAddress("-i ~/.ssh/key me@box.local")).toEqual(["-i", "~/.ssh/key", "me@box.local"])
  })

  test("refuses anything that is not one machine", () => {
    const refused = (text: string) => {
      try {
        parseAddress(text)
      } catch (error) {
        return error instanceof SshError && error.problem === "input"
      }

      return false
    }

    expect(refused("")).toBe(true)
    expect(refused("me@box rm -rf /")).toBe(true)
    expect(refused("-o ProxyCommand=evil me@box")).toBe(true)
    expect(refused("me@box;reboot")).toBe(true)
    expect(refused("-p")).toBe(true)
  })
})
