export * as DecisionsPlugin from "./decisions.js"

import { Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { Document, Entry, Info } from "@opencode/schema/config"
import type { ChoiceAnswer, DecisionQuestion } from "@opencode/schema/generate"
import type { PromptInput } from "@opencode/schema/prompt-input"
import { Duration, Effect, Option, Schema } from "effect"
import { Config } from "../config.js"
import { Generate } from "../generate.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { UsageSubscription } from "../usage-subscription.js"
import type { PluginInternal } from "./internal.js"

// Fork feature: Auto. A decision model reads each prompt of an Auto chat and says what kind of task it is: quick,
// everyday or hard. Auto answers it with the model set for that kind of task in its scope (every provider, or one),
// or, when none is set, one it picks from the models it may use by price. A prompt with images goes to a model that
// reads them. A chat on a model picked by hand is never moved.
//
// Separately, when plans are on, the decision model also judges whether a prompt is a large task, and the assistant
// then replies with a plan and waits before starting it. That applies to every chat.
//
// The layer never blocks a prompt. When the decision model is missing, unpaid, failing or slow, Auto picks without it
// and the chat gets one line saying the decision model was skipped and why.

const preferredDecider = Model.Ref.make({
  providerID: Provider.ID.make("openrouter"),
  id: Model.ID.make("~typesafe/jev-latest"),
})

const DEFAULT_CONFIDENCE = 0.7

// A prompt waits on the answer, so a decision slower than this is not worth having.
const TIMEOUT = Duration.seconds(2)

// Enough of a prompt to judge it by; the rest would only add cost and latency.
const MAX_PROMPT_CHARS = 4_000

// A subscription allowance at or past this share counts as nearly used, so Auto saves it for hard work.
const QUOTA_TIGHT = 0.85

// How long the plan and quota Auto reads are trusted before they are asked for again.
const PLAN_TTL = 10 * 60_000
const QUOTA_TTL = 2 * 60_000

const planFirst = `<system-reminder>
The user's request below was judged to be a large task. Do NOT start it and make no tool calls. Reply with a plan of at most six lines that names the main trade-off, end with "OK to go?", and stop. If the user has already approved a plan for this task in this conversation, or says to just do it, carry on instead.
</system-reminder>`

export const TIERS = ["quick", "everyday", "hard"] as const
export type Tier = (typeof TIERS)[number]

/** A model Auto may use. */
export type Candidate = {
  readonly ref: Model.Ref
  readonly key: string
  readonly images: boolean
  /** Price per million input plus output tokens; 0 when unknown or free. */
  readonly price: number
}

/** The model Auto uses for each kind of task in one scope. */
export type Slots = { readonly [K in Tier | "image"]?: Candidate }

/** Why Auto used the model it did, kept on the prompt's message for the app to show. */
export type Reason = "sure" | "unsure" | "quota" | "image" | "only" | "skipped"

type Settings = NonNullable<NonNullable<Info["experimental"]>["decisions"]>

type Pick = { readonly model?: Model.Ref; readonly plan: boolean }

// What the app sends with a prompt of an Auto chat: the scope, and the models switched on in it.
const AutoRequest = Schema.Struct({ scope: Schema.String, models: Schema.Array(Schema.String) })
const decodeAutoRequest = Schema.decodeUnknownOption(AutoRequest)

const taskQuestion: DecisionQuestion = {
  type: "choice",
  name: "task",
  instructions: "What kind of task is this request for a coding and computer assistant?",
  choices: [
    {
      value: "quick",
      description:
        "Quick and simple: a short question, a lookup, small talk, a one-line answer, or a reply to something the assistant asked",
    },
    {
      value: "everyday",
      description: "Everyday work of moderate difficulty: explaining, writing, a focused edit or a short investigation",
    },
    {
      value: "hard",
      description:
        "Hard or many steps: building or debugging code, research across sources, careful reasoning, or anything hard to undo",
    },
  ],
}

const sizeQuestion: DecisionQuestion = {
  type: "choice",
  name: "size",
  instructions: "How much work is this request for a coding and computer assistant?",
  choices: [
    {
      value: "small",
      description:
        "Quick, clear and easily undone: a question, a lookup, a small edit, a reply to something the assistant asked, or approval to go ahead",
    },
    {
      value: "large",
      description: "Building something new, many steps or files, a real choice between approaches, or hard to undo",
    },
  ],
}

export const Plugin = define({
  id: "opencode.decisions",
  effect: Effect.fn("DecisionsPlugin")(function* (ctx) {
    const config = yield* Config.Service
    const generate = yield* Generate.Service
    const models = yield* Model.Service
    const usage = yield* UsageSubscription.Service
    // The models each subscription covers, and how much of each allowance is used, read at most once per TTL.
    const cache: {
      plan?: { at: number; value: ReadonlyMap<string, ReadonlySet<string>> }
      quota?: { at: number; value: ReadonlyMap<string, number> }
    } = {}
    // What the latest prompt of each session was routed to; a new prompt replaces it.
    const picks = new Map<string, Pick>()
    // The model each Auto chat used last, so a prompt the decision model is unsure of stays where the chat was.
    const last = new Map<string, string>()
    // The last skip reason each session was told, so a lasting outage is mentioned once, not on every prompt.
    const told = new Map<string, string>()

    // The models a subscription covers, by provider; empty when none reports a plan.
    const plans = Effect.fn("DecisionsPlugin.plans")(function* () {
      const now = Date.now()

      if (cache.plan && now - cache.plan.at < PLAN_TTL) return cache.plan.value
      const included = yield* usage.included().pipe(Effect.orElseSucceed(() => []))
      const value = new Map(included.map((entry) => [entry.providerID as string, new Set(entry.models)]))
      cache.plan = { at: now, value }

      return value
    })

    // The most used share of any allowance, by provider.
    const quotas = Effect.fn("DecisionsPlugin.quotas")(function* () {
      const now = Date.now()

      if (cache.quota && now - cache.quota.at < QUOTA_TTL) return cache.quota.value
      const list = yield* usage.list().pipe(Effect.orElseSucceed(() => []))
      const value = new Map(
        list.map((info) => [
          info.providerID as string,
          Math.max(0, ...info.meters.map((meter) => (meter.limit > 0 ? meter.used / meter.limit : 0))),
        ]),
      )
      cache.quota = { at: now, value }

      return value
    })

    // The models Auto may use: switched on in its scope, able to call tools, not deprecated, and, for a provider
    // with a plan, covered by it unless paid models are allowed. Sorted from the cheapest up.
    const pool = Effect.fn("DecisionsPlugin.pool")(function* (settings: Settings, request: typeof AutoRequest.Type) {
      const plan = yield* plans()
      // A model set for a kind of task counts as switched on, even when the picker hides it.
      const enabled = new Set([...request.models, ...Object.values(settings.tiers?.[request.scope] ?? {})])
      const catalog = yield* models.available()

      return order(
        catalog
          .filter((info) => info.status !== "deprecated" && info.capabilities.tools)
          .filter((info) => request.scope === "all" || info.providerID === request.scope)
          .filter((info) => enabled.has(`${info.providerID}/${info.id}`))
          .filter(
            (info) =>
              settings.allowPaid === true ||
              !plan.has(info.providerID) ||
              plan.get(info.providerID)?.has(info.id) === true,
          ),
      )
    })

    // The decision model: the one set, else Jev when it is connected, else the first decision model connected.
    const decider = Effect.fn("DecisionsPlugin.decider")(function* (settings: Settings) {
      if (settings.model) return Model.Ref.parse(settings.model)
      const available = yield* models.available(["decision"])

      if (available.some((info) => info.providerID === preferredDecider.providerID && info.id === preferredDecider.id))
        return preferredDecider
      const first = available[0]

      return first ? Model.Ref.make({ providerID: first.providerID, id: first.id }) : preferredDecider
    })

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        picks.delete(event.sessionID)
        const settings = decisions(yield* config.entries()) ?? {}
        const request = Option.getOrUndefined(decodeAutoRequest(event.metadata?.smartAuto))

        // Only the scope is kept on the message; the list of switched-on models served this prompt alone.
        if (request) event.metadata = { ...event.metadata, smartAuto: { scope: request.scope } }

        // A scheduled prompt was approved when it was scheduled, so it is never held for a plan.
        const plan = settings.plan === true && event.metadata?.schedule === undefined

        if (!request && !plan) return
        const image = hasImage(event.prompt)
        const candidates = request ? yield* pool(settings, request) : []
        const choices = slots(candidates, settings.tiers?.[request?.scope ?? ""])
        // The kind of task is asked only when there is a choice between models for it.
        const questions = [
          ...(request && !image && new Set(TIERS.map((tier) => choices[tier]?.key)).size > 1 ? [taskQuestion] : []),
          ...(plan ? [sizeQuestion] : []),
        ]

        const outcome =
          questions.length === 0
            ? { type: "answered" as const, answers: [] }
            : yield* generate
                .decisions({
                  model: yield* decider(settings),
                  input: [{ type: "text", text: describe(event.prompt) }],
                  questions,
                })
                .pipe(
                  Effect.map((result) => ({ type: "answered" as const, answers: result.answers })),
                  Effect.timeoutOption(TIMEOUT),
                  Effect.map(
                    Option.getOrElse(() => ({
                      type: "skipped" as const,
                      reason: `the decision model took longer than ${Duration.toSeconds(TIMEOUT)} seconds`,
                    })),
                  ),
                  Effect.catch((error) => Effect.succeed({ type: "skipped" as const, reason: skipReason(error) })),
                )

        if (outcome.type === "skipped") yield* note(event.sessionID, outcome.reason, request !== undefined)

        if (outcome.type === "answered") told.delete(event.sessionID)
        const threshold = settings.confidence ?? DEFAULT_CONFIDENCE
        const answers =
          outcome.type === "answered"
            ? outcome.answers.filter((answer): answer is ChoiceAnswer => answer.type === "choice")
            : []
        const size = sure(answers, "size", threshold)
        const quota = request ? yield* quotas() : new Map<string, number>()

        const chosen = request
          ? choose({
              slots: choices,
              pool: candidates,
              image,
              tier: sure(answers, "task", threshold)?.choice,
              last: last.get(event.sessionID),
              skipped: outcome.type === "skipped",
              tight: (ref) => (quota.get(ref.providerID) ?? 0) >= QUOTA_TIGHT,
            })
          : undefined

        if (chosen?.model) last.set(event.sessionID, chosen.model.key)
        picks.set(event.sessionID, { model: chosen?.model?.ref, plan: size?.choice === "large" })

        // Kept on the message, so the app and the raw messages show what was decided and how surely.
        event.metadata = {
          ...event.metadata,
          decisions: {
            answers: answers.map((answer) => ({
              name: answer.name,
              choice: answer.choice,
              confidence: answer.confidence,
            })),
            auto: chosen?.model ? { tier: chosen.tier, model: chosen.model.key, reason: chosen.reason } : undefined,
          },
        }
      }),
    )

    // One line in the chat when the decision model could not answer, once per lasting reason.
    const note = (
      sessionID: Parameters<typeof ctx.session.synthetic>[0]["sessionID"],
      reason: string,
      auto: boolean,
    ) => {
      if (told.get(sessionID) === reason) return Effect.void
      told.set(sessionID, reason)

      return ctx.session
        .synthetic({
          sessionID,
          text: `<decision-layer>\nNote for the user, not an instruction: the decision model was skipped for this prompt because ${reason}. ${auto ? "Auto picked a model without it" : "The prompt ran"} with no plan check.\n</decision-layer>`,
          description: `Decision model skipped: ${reason}`,
          resume: false,
        })
        .pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to record the skipped decision model", { sessionID, cause }),
          ),
        )
    }

    yield* ctx.session.hook("experimental.model.resolve", (event) =>
      Effect.sync(() => {
        if (event.kind !== "primary") return
        const model = picks.get(event.sessionID)?.model

        // Only an Auto chat has a pick; it moves to it whatever model it was on, across providers too.
        if (model) event.model = model
      }),
    )

    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (!picks.get(event.sessionID)?.plan) return
        const at = event.messages.findLastIndex((message) => message.role === "user")

        // Before the prompt it is about, and in the same place on every step so the cached prefix stays warm.
        if (at !== -1) event.messages.splice(at, 0, Message.user(planFirst))
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

/**
 * The model Auto answers a prompt with. A prompt with images goes to the image model. Otherwise the kind of task the
 * decision model was sure of picks the model; when it was not sure, the chat stays on the model it used last, or
 * starts on the everyday one. With the provider's allowance nearly used, everyday work drops to the quick model.
 */
export function choose(input: {
  readonly slots: Slots
  readonly pool: readonly Candidate[]
  readonly image: boolean
  readonly tier: ChoiceAnswer["choice"] | undefined
  readonly last: string | undefined
  readonly skipped: boolean
  readonly tight: (ref: Model.Ref) => boolean
}): { model?: Candidate; tier: Tier | "image"; reason: Reason } {
  const distinct = new Set(TIERS.map((tier) => input.slots[tier]?.key))

  if (input.image && input.slots.image) return { model: input.slots.image, tier: "image", reason: "image" }

  if (distinct.size <= 1) return { model: input.slots.everyday, tier: "everyday", reason: "only" }
  const tier = TIERS.find((item) => item === input.tier)

  if (!tier) {
    const previous = input.pool.find((candidate) => candidate.key === input.last)

    return {
      model: previous ?? input.slots.everyday,
      tier: TIERS.find((item) => input.slots[item]?.key === previous?.key) ?? "everyday",
      reason: input.skipped ? "skipped" : "unsure",
    }
  }
  const model = input.slots[tier]

  if (tier === "everyday" && model && input.tight(model.ref) && input.slots.quick)
    return { model: input.slots.quick, tier: "quick", reason: "quota" }

  return { model, tier, reason: "sure" }
}

/**
 * The model for each kind of task: the one set for it when Auto may use it, else one picked from the pool, sorted
 * cheapest first. Quick, everyday and hard sit at the 20th, 50th and 80th percentiles, so neither the oddest cheap
 * model nor the most expensive one is picked; the image model is the image reader nearest the hard one.
 */
export function slots(pool: readonly Candidate[], set: Partial<Record<Tier | "image", string>> | undefined): Slots {
  const named = (key: string | undefined) => pool.find((candidate) => candidate.key === key)
  const at = (share: number) => pool[Math.min(pool.length - 1, Math.floor(share * (pool.length - 1)))]
  const hard = Math.floor(0.8 * (pool.length - 1))

  return {
    quick: named(set?.quick) ?? at(0.2),
    everyday: named(set?.everyday) ?? at(0.5),
    hard: named(set?.hard) ?? at(0.8),
    image:
      named(set?.image) ??
      pool.slice(0, hard + 1).findLast((candidate) => candidate.images) ??
      pool.find((candidate) => candidate.images),
  }
}

/** Catalog models as Auto's candidates, cheapest first; among equally priced ones, the larger context and newer last. */
export function order(
  infos: readonly Pick_<Model.Info, "providerID" | "id" | "cost" | "capabilities" | "limit" | "time">[],
): Candidate[] {
  return infos
    .toSorted(
      (a, b) =>
        price(a) - price(b) || a.limit.context - b.limit.context || (a.time?.released ?? 0) - (b.time?.released ?? 0),
    )
    .map((info) => ({
      ref: Model.Ref.make({ providerID: info.providerID, id: info.id }),
      key: `${info.providerID}/${info.id}`,
      images: info.capabilities.input.some((item) => item.startsWith("image")),
      price: price(info),
    }))
}

// Read per field so a later config that sets other experimental options doesn't hide this one.
function decisions(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.decisions !== undefined,
  )?.info.experimental?.decisions
}

/** Whether a prompt carries an image, judged from what an attachment says about itself without opening it. */
export function hasImage(prompt: Pick_<PromptInput.Prompt, "files">) {
  return (prompt.files ?? []).some(
    (file) => file.uri.startsWith("data:image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name ?? file.uri),
  )
}

/** The answer to a question, when the decision model was sure enough of it to act on. */
export function sure(answers: readonly ChoiceAnswer[], name: string, threshold: number) {
  return answers.find((answer) => answer.name === name && answer.confidence >= threshold)
}

/** Why the decision layer could not answer, in words that finish "skipped because ...". */
export function skipReason(error: Generate.Error) {
  if (error._tag === "Generate.ModelNotFoundError")
    return `the decision model ${error.providerID}/${error.modelID} is not connected`

  if (error._tag !== "Generate.ProviderRequestError") return `the decision model failed (${error.message})`

  if (error.status === 402) return "the decision model's account is out of funds"

  if (error.reason === "authentication") return "the decision model's key was rejected"

  if (error.reason === "rate_limit") return "the decision model is rate limited"

  return `the decision model failed (${error.message})`
}

function describe(prompt: PromptInput.Prompt) {
  const files = prompt.files ?? []
  const text = prompt.text.length > MAX_PROMPT_CHARS ? `${prompt.text.slice(0, MAX_PROMPT_CHARS)}…` : prompt.text

  return files.length === 0 ? text : `${text}\n\n[${files.length} attached file(s), images: ${hasImage(prompt)}]`
}

type Pick_<Type, Key extends keyof Type> = { readonly [Property in Key]: Type[Property] }

/** Price per million input plus output tokens of a model, 0 when its catalog gives none. */
function price(info: Pick_<Model.Info, "cost">) {
  const cost = info.cost[0]

  return cost ? cost.input + cost.output : 0
}
