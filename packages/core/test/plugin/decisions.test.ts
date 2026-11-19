import { expect, test } from "bun:test"
import type { ChoiceAnswer } from "@opencode/schema/generate"
import { Generate } from "../../src/generate"
import { DecisionsPlugin } from "../../src/plugin/decisions"

const answer = (name: string, choice: string, confidence: number) =>
  ({ type: "choice", name, choice, confidence, probabilities: [] }) satisfies ChoiceAnswer

const info = (id: string, input: number, output: number, options: { image?: boolean; context?: number } = {}) => ({
  providerID: "nano",
  id,
  cost: [{ input, output, cache: { read: 0, write: 0 } }],
  capabilities: { tools: true, input: options.image ? ["text", "image"] : ["text"], output: ["text"] },
  limit: { context: options.context ?? 100_000, output: 8_000 },
  time: { released: 0 },
})

// SAFETY: order reads only the IDs, price, image input, context and release time of each model.
const pool = DecisionsPlugin.order([
  info("ultra", 60, 240),
  info("tiny", 0.01, 0.02),
  info("pro", 2, 4),
  info("mid", 0.5, 1),
  info("vision", 1, 2, { image: true }),
  info("flash", 0.1, 0.2),
] as never)

const never = () => false

test.each([
  [{ files: [{ uri: "data:image/png;base64,AAAA" }] }, true],
  [{ files: [{ uri: "file:///tmp/upload/photo.JPG" }] }, true],
  [{ files: [{ uri: "file:///tmp/abc", name: "diagram.webp" }] }, true],
  [{ files: [{ uri: "file:///tmp/notes.md" }] }, false],
  [{}, false],
])("an attachment is recognised as an image from its own description: %j", (prompt, expected) => {
  expect(DecisionsPlugin.hasImage(prompt)).toBe(expected)
})

test("an answer is acted on only when the decision model is sure enough", () => {
  const answers = [answer("task", "quick", 0.9), answer("size", "large", 0.55)]

  expect(DecisionsPlugin.sure(answers, "task", 0.7)?.choice).toBe("quick")
  expect(DecisionsPlugin.sure(answers, "size", 0.7)).toBeUndefined()
  expect(DecisionsPlugin.sure(answers, "size", 0.5)?.choice).toBe("large")
})

test("free models are ordered by context and release, not left in catalog order", () => {
  // SAFETY: as above.
  const free = DecisionsPlugin.order([
    info("big", 0, 0, { context: 1_000_000 }),
    info("small", 0, 0, { context: 32_000 }),
  ] as never)

  expect(free.map((candidate) => candidate.key)).toEqual(["nano/small", "nano/big"])
})

test("each kind of task gets a model from the pool, skipping the price extremes, unless one is set for it", () => {
  const automatic = DecisionsPlugin.slots(pool, undefined)

  expect(automatic.quick?.key).toBe("nano/flash")
  expect(automatic.everyday?.key).toBe("nano/mid")
  expect(automatic.hard?.key).toBe("nano/pro")
  expect(automatic.image?.key).toBe("nano/vision")

  const set = DecisionsPlugin.slots(pool, { hard: "nano/ultra", quick: "other/gone" })

  expect(set.hard?.key).toBe("nano/ultra")
  // A model Auto may not use, such as one of a provider switched off, is picked for instead.
  expect(set.quick?.key).toBe("nano/flash")
  expect(DecisionsPlugin.slots([], undefined).everyday).toBeUndefined()
})

test("Auto answers with the model for the kind of task the decision model was sure of", () => {
  const slots = DecisionsPlugin.slots(pool, undefined)
  const base = { slots, pool, image: false, last: undefined, skipped: false, tight: never }

  expect(DecisionsPlugin.choose({ ...base, tier: "hard" })).toMatchObject({ tier: "hard", reason: "sure" })
  expect(DecisionsPlugin.choose({ ...base, tier: "hard" }).model?.key).toBe("nano/pro")
  expect(DecisionsPlugin.choose({ ...base, tier: "quick", image: true }).model?.key).toBe("nano/vision")
})

test("when the decision model is unsure, the chat stays on its last model, or starts on the everyday one", () => {
  const slots = DecisionsPlugin.slots(pool, undefined)
  const base = { slots, pool, image: false, tier: undefined, skipped: false, tight: never }

  expect(DecisionsPlugin.choose({ ...base, last: "nano/pro" })).toMatchObject({ tier: "hard", reason: "unsure" })
  expect(DecisionsPlugin.choose({ ...base, last: undefined }).model?.key).toBe("nano/mid")
  expect(DecisionsPlugin.choose({ ...base, last: "nano/gone", skipped: true })).toMatchObject({
    tier: "everyday",
    reason: "skipped",
  })
})

test("with the allowance nearly used, everyday work drops to the quick model but hard work does not", () => {
  const slots = DecisionsPlugin.slots(pool, undefined)
  const base = { slots, pool, image: false, last: undefined, skipped: false, tight: () => true }

  expect(DecisionsPlugin.choose({ ...base, tier: "everyday" })).toMatchObject({ tier: "quick", reason: "quota" })
  expect(DecisionsPlugin.choose({ ...base, tier: "hard" }).model?.key).toBe("nano/pro")
})

test("a single model in scope answers everything without a question", () => {
  const one = pool.slice(0, 1)

  expect(
    DecisionsPlugin.choose({
      slots: DecisionsPlugin.slots(one, undefined),
      pool: one,
      image: false,
      tier: undefined,
      last: undefined,
      skipped: false,
      tight: never,
    }),
  ).toMatchObject({ reason: "only" })
})

test.each([
  [
    new Generate.ProviderRequestError({
      providerID: "openrouter",
      reason: "provider",
      message: "no credits",
      status: 402,
    }),
    "the decision model's account is out of funds",
  ],
  [
    new Generate.ProviderRequestError({ providerID: "openrouter", reason: "authentication", message: "bad key" }),
    "the decision model's key was rejected",
  ],
  [
    new Generate.ProviderRequestError({ providerID: "openrouter", reason: "rate_limit", message: "slow down" }),
    "the decision model is rate limited",
  ],
  [
    new Generate.ModelNotFoundError({ providerID: "openrouter", modelID: "jev", message: "missing" }),
    "the decision model openrouter/jev is not connected",
  ],
  [new Generate.UnavailableError({ message: "no decision client" }), "the decision model failed (no decision client)"],
])("a failed decision names why the layer was skipped", (error, reason) => {
  expect(DecisionsPlugin.skipReason(error)).toBe(reason)
})
