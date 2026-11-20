import { describe, expect, test } from "bun:test"
import { lastDecision, shortModel, switchedTo } from "./decision"

describe("routing decision", () => {
  test("reads the latest decided prompt and skips undecided ones", () => {
    expect(
      lastDecision([
        { type: "user", metadata: { decisions: { answers: [{ name: "task", choice: "hard", confidence: 0.9 }] } } },
        { type: "assistant" },
        {
          type: "user",
          metadata: {
            decisions: {
              answers: [{ name: "task", choice: "quick", confidence: 0.93 }],
              auto: { tier: "quick", model: "nano/flash", reason: "sure" },
            },
          },
        },
        { type: "user" },
      ]),
    ).toEqual({
      answers: [{ name: "task", choice: "quick", confidence: 0.93 }],
      auto: { tier: "quick", model: "nano/flash", reason: "sure" },
    })
  })

  test("is nothing for a chat with no decision, or one kept in a shape it does not know", () => {
    expect(lastDecision([{ type: "user" }])).toBeUndefined()
    expect(
      lastDecision([{ type: "user", metadata: { decisions: { answers: [{ name: "model" }, 3] } } }]),
    ).toBeUndefined()
  })

  test("names a model by its last segment", () => {
    expect(shortModel("nano-gpt/deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash")
    expect(shortModel("plain")).toBe("plain")
  })
})

describe("switched model", () => {
  const prompt = {
    type: "user",
    metadata: { decisions: { answers: [], auto: { tier: "hard", model: "nano/pro", reason: "sure" } } },
  }

  test("names the model that answered when it is not Auto's pick", () => {
    expect(switchedTo([prompt, { type: "assistant", model: { providerID: "other", id: "max" } }], "nano/pro")).toBe(
      "other/max",
    )
  })

  test("is nothing when the pick answered or nothing answered yet", () => {
    expect(switchedTo([prompt, { type: "assistant", model: { providerID: "nano", id: "pro" } }], "nano/pro")).toBeUndefined()
    expect(switchedTo([prompt], "nano/pro")).toBeUndefined()
  })
})
