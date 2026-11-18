import { describe, expect, test } from "bun:test"
import { withoutEntry } from "../src/config"

describe("removing a config entry", () => {
  test("leaves a document alone that has no such entry, or not even its section", () => {
    const fresh = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'

    expect(withoutEntry(fresh, ["provider", "mine"])).toBe(fresh)
    expect(withoutEntry('{ "provider": {} }', ["provider", "mine"])).toBe('{ "provider": {} }')
    expect(withoutEntry("", ["provider", "mine"])).toBe("")
  })

  test("removes the entry and keeps its neighbours and the comments", () => {
    const text = '{\n  // old format\n  "provider": {\n    "mine": { "a": 1 },\n    "other": {}\n  }\n}\n'

    expect(withoutEntry(text, ["provider", "mine"])).toBe('{\n  // old format\n  "provider": {\n    "other": {}\n  }\n}\n')
  })
})
