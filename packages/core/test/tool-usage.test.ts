import { describe, expect, test } from "bun:test"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { UsageTool } from "../src/tool/plugin/usage"

const providerID = Provider.ID.make("nano-gpt")

const usage = UsageTool.combine({
  asOf: 1_000,
  subscriptions: [
    {
      providerID,
      name: "NanoGPT",
      active: true,
      meters: [{ unit: "input_tokens", window: "weekly", used: 15_000_000, limit: 60_000_000, resetsAt: 2_000 }],
    },
  ],
  history: [
    {
      providerID,
      name: "NanoGPT",
      from: "2026-10-19",
      to: "2026-11-17",
      models: [
        { model: "small", requests: 2, tokens: { input: 10, output: 5 }, cost: Money.USD.make(0) },
        { model: "big", requests: 9, tokens: { input: 900, output: 100 }, cost: Money.USD.make(0.5) },
      ],
    },
  ],
})

describe("usage tool", () => {
  test("joins each provider's allowances with its history, busiest model first", () => {
    expect(usage.providers).toHaveLength(1)
    expect(usage.providers[0]?.meters[0]?.percent).toBe(25)
    expect(usage.providers[0]?.from).toBe("2026-10-19")
    expect(usage.providers[0]?.models.map((entry) => entry.model)).toEqual(["big", "small"])
  })

  test("shows the allowances of a provider whose history could not be read", () => {
    const alone = UsageTool.combine({ asOf: 1, subscriptions: [{ providerID, name: "NanoGPT", active: false, meters: [] }], history: [] })

    expect(alone.providers[0]).toEqual({ name: "NanoGPT", active: false, meters: [], models: [] })
  })

  test("words the result and ends it with the card to copy", () => {
    expect(UsageTool.usageText(usage)).toContain("weekly input tokens: 15M of 60M (25%)")
    expect(UsageTool.usageText(usage)).toContain("big: 9 requests, 900 in, 100 out, $0.50")
    const hint = UsageTool.cardHint(usage)

    expect(hint).toContain("```visual\n<usage-card><script type=\"application/json\">")
    expect(hint.endsWith("</usage-card>\n```")).toBe(true)
  })
})
