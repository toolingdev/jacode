import { describe, expect, test } from "bun:test"
import type { UsageSubscriptionHistory, UsageSubscriptionInfo } from "@opencode/client/promise"
import { headline, meterRows, modelRows } from "./view"

const nanogpt: UsageSubscriptionInfo[] = [
  {
    providerID: "nanogpt-sub",
    name: "NanoGPT Subscription",
    active: true,
    meters: [
      { unit: "images", window: "daily", used: 90, limit: 100, resetsAt: 1794700800000 },
      { unit: "input_tokens", window: "weekly", used: 26_128_063, limit: 60_000_000, resetsAt: 1794787200000 },
    ],
  },
]

describe("subscription usage view", () => {
  test("lists every allowance with a rounded percent", () => {
    expect(meterRows(nanogpt).map((row) => [row.unit, row.window, row.percent])).toEqual([
      ["images", "daily", 90],
      ["input_tokens", "weekly", 44],
    ])
  })

  test("caps an overdrawn allowance at 100 and treats an empty limit as used up", () => {
    const rows = meterRows([
      {
        providerID: "p",
        name: "P",
        active: true,
        meters: [
          { unit: "input_tokens", window: "weekly", used: 70, limit: 60, resetsAt: 1 },
          { unit: "input_tokens", window: "daily", used: 0, limit: 0, resetsAt: 1 },
        ],
      },
    ])

    expect(rows.map((row) => row.percent)).toEqual([100, 100])
  })

  test("headlines the fullest token allowance over a fuller image allowance", () => {
    expect(headline(meterRows(nanogpt))).toMatchObject({ unit: "input_tokens", window: "weekly", percent: 44 })
  })

  test("headlines an image allowance when the subscription has no token allowance", () => {
    const images: UsageSubscriptionInfo[] = [
      {
        providerID: "p",
        name: "P",
        active: true,
        meters: [{ unit: "images", window: "daily", used: 5, limit: 10, resetsAt: 1 }],
      },
    ]

    expect(headline(meterRows(images))).toMatchObject({ unit: "images", percent: 50 })
  })

  test("has no headline without subscriptions", () => {
    expect(headline(meterRows([]))).toBeUndefined()
  })

  test("lists the history's models by the tokens they used, most first", () => {
    const histories: UsageSubscriptionHistory[] = [
      {
        providerID: "nanogpt-sub",
        name: "NanoGPT Subscription",
        from: "2026-10-16",
        to: "2026-11-14",
        models: [
          { model: "DeepSeek V4 Flash", requests: 1, tokens: { input: 6, output: 2 }, cost: 0 },
          { model: "DeepSeek V4 Pro", requests: 1, tokens: { input: 61_574, output: 89 }, cost: 0.25 },
        ],
      },
    ]

    expect(modelRows(histories)).toEqual([
      {
        key: "nanogpt-sub\nDeepSeek V4 Pro",
        model: "DeepSeek V4 Pro",
        requests: 1,
        input: 61_574,
        output: 89,
        cost: 0.25,
      },
      { key: "nanogpt-sub\nDeepSeek V4 Flash", model: "DeepSeek V4 Flash", requests: 1, input: 6, output: 2, cost: 0 },
    ])
  })
})
