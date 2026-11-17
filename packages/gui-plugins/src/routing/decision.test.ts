import { describe, expect, test } from "bun:test"
import { lastDecision, shortModel } from "./decision"

describe("routing decision", () => {
  test("reads the latest decided prompt and skips undecided ones", () => {
    expect(
      lastDecision([
        { type: "user", metadata: { decisions: { answers: [{ name: "model", choice: "a/old", confidence: 0.9 }] } } },
        { type: "assistant" },
        {
          type: "user",
          metadata: {
            decisions: {
              answers: [
                { name: "model", choice: "nano-gpt/deepseek/deepseek-v4-flash", confidence: 0.93 },
                { name: "size", choice: "small", confidence: 0.8 },
              ],
            },
          },
        },
        { type: "user" },
      ]),
    ).toEqual([
      { name: "model", choice: "nano-gpt/deepseek/deepseek-v4-flash", confidence: 0.93 },
      { name: "size", choice: "small", confidence: 0.8 },
    ])
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
