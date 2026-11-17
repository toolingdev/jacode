import { expect, test } from "bun:test"
import type { ChoiceAnswer } from "@opencode/schema/generate"
import { Generate } from "../../src/generate"
import { DecisionsPlugin } from "../../src/plugin/decisions"

const pool = [
  { key: "nano/pro", use: "Hard coding work", images: false },
  { key: "nano/flash", use: "Quick questions", images: false },
  { key: "nano/kimi", use: "Anything with images", images: true },
]

const answer = (name: string, choice: string, confidence: number) =>
  ({ type: "choice", name, choice, confidence, probabilities: [] }) satisfies ChoiceAnswer

test("a prompt with an image may only go to models that read images", () => {
  expect(DecisionsPlugin.usable(pool, true).map((item) => item.key)).toEqual(["nano/kimi"])
  expect(DecisionsPlugin.usable(pool, false)).toHaveLength(3)
})

test.each([
  [{ files: [{ uri: "data:image/png;base64,AAAA" }] }, true],
  [{ files: [{ uri: "file:///tmp/upload/photo.JPG" }] }, true],
  [{ files: [{ uri: "file:///tmp/abc", name: "diagram.webp" }] }, true],
  [{ files: [{ uri: "file:///tmp/notes.md" }] }, false],
  [{}, false],
])("an attachment is recognised as an image from its own description: %j", (prompt, expected) => {
  expect(DecisionsPlugin.hasImage(prompt)).toBe(expected)
})

test("a model is asked about only when there is a choice, and size only when plans are on", () => {
  expect(DecisionsPlugin.ask(pool, true).map((question) => question.name)).toEqual(["model", "size"])
  expect(DecisionsPlugin.ask(pool.slice(0, 1), true).map((question) => question.name)).toEqual(["size"])
  expect(DecisionsPlugin.ask(pool, false).map((question) => question.name)).toEqual(["model"])
  expect(DecisionsPlugin.ask([], false)).toEqual([])
})

test("an answer is acted on only when the decision model is sure enough", () => {
  const answers = [answer("model", "nano/flash", 0.9), answer("size", "large", 0.55)]

  expect(DecisionsPlugin.sure(answers, "model", 0.7)?.choice).toBe("nano/flash")
  expect(DecisionsPlugin.sure(answers, "size", 0.7)).toBeUndefined()
  expect(DecisionsPlugin.sure(answers, "size", 0.5)?.choice).toBe("large")
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
