import { expect, test } from "bun:test"
import type { ChoiceAnswer } from "@opencode/schema/generate"
import { Generate } from "../../src/generate"
import { DecisionsPlugin } from "../../src/plugin/decisions"

const answer = (name: string, choice: string, confidence: number) =>
  ({ type: "choice", name, choice, confidence, probabilities: [] }) satisfies ChoiceAnswer

const info = (
  id: string,
  input: number,
  output: number,
  options: { image?: boolean; context?: number; reasons?: boolean; provider?: string; released?: number } = {},
) => ({
  providerID: options.provider ?? "nano",
  id,
  name: id,
  cost: [{ input, output, cache: { read: 0, write: 0 } }],
  capabilities: { tools: true, input: options.image ? ["text", "image"] : ["text"], output: ["text"] },
  limit: { context: options.context ?? 100_000, output: 8_000 },
  time: { released: options.released ?? 0 },
  compatibility: options.reasons ? { reasoningField: "reasoning" } : undefined,
  variants: [],
})

// SAFETY: candidates reads only the fields info sets.
const build = (list: ReturnType<typeof info>[]) => DecisionsPlugin.candidates(list as never)

const pool = build([
  info("ultra-max", 60, 240, { reasons: true }),
  info("tiny", 0.01, 0.02),
  info("pro", 2, 4, { reasons: true }),
  info("mid", 0.5, 1),
  info("vision", 1, 2, { image: true }),
  info("flash", 0.1, 0.2),
])

const keys = (list: readonly { key: string }[]) => list.map((item) => item.key)
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

test("strength rises with price, reasoning and a stronger name, so free models can still be told apart", () => {
  const free = build([
    info("lite-chat", 0, 0),
    info("big-thinking", 0, 0, { reasons: true }),
    info("plain", 0, 0),
  ])
  const strength = Object.fromEntries(free.map((item) => [item.key, item.strength]))

  expect(strength["nano/big-thinking"]).toBe(1)
  expect(strength["nano/lite-chat"]).toBe(0)
  expect(strength["nano/plain"]).toBe(0.5)
})

test("each kind of task gets a short list from its band of strength, and a set model is its whole list", () => {
  const lists = DecisionsPlugin.shortlists(pool, undefined, 0)

  expect(keys(lists.quick)[0]).toBe("nano/tiny")
  expect(keys(lists.hard)[0]).toBe("nano/ultra-max")
  expect(keys(lists.image)).toEqual(["nano/vision"])
  expect(lists.everyday.length).toBeGreaterThan(0)
  expect(keys(DecisionsPlugin.shortlists(pool, { hard: "nano/mid" }, 0).hard)).toEqual(["nano/mid"])
  // A model unable to hold the prompt is left out while others can; when none can, all stay.
  const roomy = build([info("small", 0.1, 0.1), info("roomy", 0.1, 0.1, { context: 400_000 })])
  expect(keys(DecisionsPlugin.shortlists(roomy, undefined, 150_000).everyday)).toEqual(["nano/roomy"])
  expect(DecisionsPlugin.shortlists(pool, undefined, 900_000).hard.length).toBeGreaterThan(0)
})

test("a list keeps to two models of one provider while other providers have some to offer", () => {
  const mixed = build([
    info("a1", 1, 1, { provider: "a" }),
    info("a2", 1, 1, { provider: "a" }),
    info("a3", 1, 1, { provider: "a" }),
    info("b1", 1, 1, { provider: "b" }),
  ])
  const everyday = DecisionsPlugin.shortlists(mixed, undefined, 0).everyday

  expect(everyday.filter((item) => item.ref.providerID === "a").length).toBeLessThanOrEqual(2)
})

test("the decision model is asked the difficulty and, per kind of task, which model of its list", () => {
  const lists = DecisionsPlugin.shortlists(pool, undefined, 0)

  expect(DecisionsPlugin.ask(lists, false).map((question) => question.name)).toContain("task")
  expect(DecisionsPlugin.ask(lists, true).map((question) => question.name)).toEqual([])
  expect(DecisionsPlugin.describeModel(pool[0]!)).toContain("per million tokens")
})

const base = (lists: DecisionsPlugin.Lists) => ({
  lists,
  pool,
  image: false,
  last: undefined,
  skipped: false,
  tight: never,
  picked: () => undefined,
})

test("Auto uses the decision model's pick from the list of the difficulty it was sure of", () => {
  const lists = DecisionsPlugin.shortlists(pool, undefined, 0)
  const second = lists.hard[1]?.key

  expect(DecisionsPlugin.choose({ ...base(lists), tier: "hard", picked: () => second })).toMatchObject({
    tier: "hard",
    reason: "sure",
    model: { key: second },
  })
  expect(DecisionsPlugin.choose({ ...base(lists), tier: "hard" })).toMatchObject({ reason: "band", model: lists.hard[0] })
  expect(DecisionsPlugin.choose({ ...base(lists), tier: "quick", image: true }).model?.key).toBe("nano/vision")
})

test("when the difficulty is unsure, the chat stays on its last model, or starts on the first everyday one", () => {
  const lists = DecisionsPlugin.shortlists(pool, undefined, 0)

  expect(DecisionsPlugin.choose({ ...base(lists), tier: undefined, last: "nano/pro" })).toMatchObject({
    reason: "unsure",
    model: { key: "nano/pro" },
  })
  expect(DecisionsPlugin.choose({ ...base(lists), tier: undefined }).model).toEqual(lists.everyday[0])
  expect(DecisionsPlugin.choose({ ...base(lists), tier: undefined, skipped: true }).reason).toBe("skipped")
})

test("with the allowance nearly used, everyday work drops to the quick list but hard work does not", () => {
  const lists = DecisionsPlugin.shortlists(pool, undefined, 0)
  const tight = { ...base(lists), tight: () => true }

  expect(DecisionsPlugin.choose({ ...tight, tier: "everyday" })).toMatchObject({ tier: "quick", reason: "quota" })
  expect(DecisionsPlugin.choose({ ...tight, tier: "hard" }).tier).toBe("hard")
})

test("a single model Auto may use answers everything", () => {
  const one = pool.slice(0, 1)

  expect(
    DecisionsPlugin.choose({ ...base(DecisionsPlugin.shortlists(one, undefined, 0)), pool: one, tier: undefined }),
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
