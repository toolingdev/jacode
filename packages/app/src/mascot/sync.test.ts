import { describe, expect, test } from "bun:test"
import { findSprite } from "./sprites"
import { companionInstruction, syncCompanion } from "./sync"

function fake(initial: { key: string; value: string }[]) {
  const calls: string[] = []
  const state = new Map(initial.map((entry) => [entry.key, entry.value]))

  return {
    calls,
    state,
    entries: {
      list: async () => [...state].map(([key, value]) => ({ key, value })),
      put: async (input: { key: string; value: string }) => {
        calls.push(`put ${input.key}`)
        state.set(input.key, input.value)
      },
      remove: async (input: { key: string }) => {
        calls.push(`remove ${input.key}`)
        state.delete(input.key)
      },
    },
  }
}

describe("companion sync", () => {
  test("attaches the chosen character to a session that has none", async () => {
    const server = fake([])
    await syncCompanion(server.entries, "ses_1", findSprite("ribbit"))

    expect(server.calls).toEqual(["put companion"])
    expect(server.state.get("companion")).toContain("Ribbit")
  })

  test("writes nothing when the session already has the chosen character", async () => {
    const server = fake([{ key: "companion", value: companionInstruction(findSprite("ribbit")) }])
    await syncCompanion(server.entries, "ses_1", findSprite("ribbit"))

    expect(server.calls).toEqual([])
  })

  test("replaces the character when the user picks another", async () => {
    const server = fake([{ key: "companion", value: companionInstruction(findSprite("ribbit")) }])
    await syncCompanion(server.entries, "ses_1", findSprite("bolt"))

    expect(server.calls).toEqual(["put companion"])
    expect(server.state.get("companion")).toContain("Bolt")
  })

  test("removes the character when companions are turned off, and leaves other entries alone", async () => {
    const server = fake([
      { key: "companion", value: companionInstruction(findSprite("ribbit")) },
      { key: "other", value: "kept" },
    ])

    await syncCompanion(server.entries, "ses_1", undefined)
    await syncCompanion(server.entries, "ses_1", undefined)

    expect(server.calls).toEqual(["remove companion"])
    expect(server.state.get("other")).toBe("kept")
  })
})
