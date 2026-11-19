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

// Fork feature: Auto, in two stages. A decision model reads each prompt of an Auto chat and says how hard it is:
// quick, everyday or hard. Code then narrows the models Auto may use to the few that fit: able to read the prompt's
// images and hold it, and in the band of strength that difficulty calls for. The decision model picks the model from
// that short list. Both answers come from one call: the short list of every band is offered at once, and the band
// the difficulty names is the one used. A model set for a kind of task in Settings takes the place of its list. A
// chat on a model picked by hand is never moved.
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

// The most models the decision model is offered for one kind of task, and how many may share a provider.
const SHORTLIST = 5
const PER_PROVIDER = 2

// How long the plan and quota Auto reads are trusted before they are asked for again.
const PLAN_TTL = 10 * 60_000
const QUOTA_TTL = 2 * 60_000

const planFirst = `<system-reminder>
The user's request below was judged to be a large task. Do NOT start it and make no tool calls. Reply with a plan of at most six lines that names the main trade-off, end with "OK to go?", and stop. If the user has already approved a plan for this task in this conversation, or says to just do it, carry on instead.
</system-reminder>`

export const TIERS = ["quick", "everyday", "hard"] as const
export type Tier = (typeof TIERS)[number]

export type Band = Tier | "image"

/** A model Auto may use, with what the decision model is told about it. */
export type Candidate = {
  readonly ref: Model.Ref
  readonly key: string
  readonly name: string
  readonly images: boolean
  /** Price per million input plus output tokens; 0 when unknown or free. */
  readonly price: number
  readonly context: number
  readonly reasons: boolean
  readonly released: number
  /** How strong the model is among the ones Auto may use, from 0 (weakest) to 1 (strongest). */
  readonly strength: number
}

/** The models the decision model may pick from for each kind of task. */
export type Lists = { readonly [K in Band]: readonly Candidate[] }

/** Why Auto used the model it did, kept on the prompt's message for the app to show. */
export type Reason = "sure" | "band" | "set" | "unsure" | "quota" | "only" | "skipped"

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
    // with a plan, covered by it unless paid models are allowed.
    const autoPool = Effect.fn("DecisionsPlugin.pool")(function* (settings: Settings, request: typeof AutoRequest.Type) {
      const plan = yield* plans()
      // A model set for a kind of task counts as switched on, even when the picker hides it.
      const enabled = new Set([...request.models, ...Object.values(settings.tiers?.[request.scope] ?? {})])
      const catalog = yield* models.available()

      return candidates(
        catalog
          .filter((info) => info.status !== "deprecated" && info.capabilities.tools && !ROUTER.test(info.id))
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
        const pool = request ? yield* autoPool(settings, request) : []
        const lists = shortlists(pool, settings.tiers?.[request?.scope ?? ""], need(event.prompt))
        const questions = [...(request ? ask(lists, image) : []), ...(plan ? [sizeQuestion] : [])]

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
              lists,
              pool,
              image,
              tier: sure(answers, "task", threshold)?.choice,
              // Every model of a list fits the prompt, so the decision model's pick is taken however sure it is.
              picked: (band) => answers.find((answer) => answer.name === `model-${band}`)?.choice,
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
            auto: chosen?.model
              ? { tier: chosen.tier, model: chosen.model.key, reason: chosen.reason, from: chosen.from }
              : undefined,
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
 * The model Auto answers a prompt with. The difficulty the decision model was sure of names a kind of task, and its
 * pick from that kind's list is used, else the list's first. A prompt with images uses the image list. When the
 * decision model was not sure of the difficulty, the chat stays on the model it used last, or starts on the first
 * everyday one. With the provider's allowance nearly used, everyday work drops to the quick list.
 */
export function choose(input: {
  readonly lists: Lists
  readonly pool: readonly Candidate[]
  readonly image: boolean
  readonly tier: ChoiceAnswer["choice"] | undefined
  readonly picked: (band: Band) => ChoiceAnswer["choice"] | undefined
  readonly last: string | undefined
  readonly skipped: boolean
  readonly tight: (ref: Model.Ref) => boolean
}): { model?: Candidate; tier: Band; reason: Reason; from: number } {
  const from = (band: Band, reason: Reason) => {
    const list = input.lists[band]
    const answer = list.find((candidate) => candidate.key === input.picked(band))

    if (list.length === 1) return { model: list[0], tier: band, reason: reason === "sure" ? "set" : reason, from: 1 }

    return { model: answer ?? list[0], tier: band, reason: answer ? reason : "band", from: list.length }
  }

  if (input.pool.length <= 1) return { model: input.pool[0], tier: "everyday", reason: "only", from: input.pool.length }

  if (input.image && input.lists.image.length > 0) return from("image", "sure")
  const tier = TIERS.find((item) => item === input.tier)

  if (!tier) {
    const previous = input.pool.find((candidate) => candidate.key === input.last)

    if (previous) return { model: previous, tier: band(input.lists, previous), reason: input.skipped ? "skipped" : "unsure", from: 1 }

    return { ...from("everyday", "sure"), reason: input.skipped ? "skipped" : "unsure" }
  }
  const usual = from(tier, "sure")

  if (tier === "everyday" && usual.model && input.tight(usual.model.ref) && input.lists.quick.length > 0)
    return { ...from("quick", "sure"), reason: "quota" }

  return usual
}

/** The kind of task a model's list puts it in, for a chat staying on its last model. */
function band(lists: Lists, model: Candidate): Band {
  return TIERS.find((tier) => lists[tier].some((candidate) => candidate.key === model.key)) ?? "everyday"
}

/** One question for the difficulty and one per kind of task with a choice to make; none when there is no choice. */
export function ask(lists: Lists, image: boolean): DecisionQuestion[] {
  const bands: Band[] = image ? ["image"] : [...TIERS]
  const picks = bands.flatMap((item) =>
    lists[item].length > 1
      ? [
          {
            type: "choice" as const,
            name: `model-${item}`,
            instructions: `If this request is ${bandWords[item]}, which model should answer it?`,
            choices: lists[item].map((candidate) => ({ value: candidate.key, description: describeModel(candidate) })),
          },
        ]
      : [],
  )
  const distinct = new Set(TIERS.flatMap((tier) => lists[tier].map((candidate) => candidate.key)))

  return [...(!image && distinct.size > 1 ? [taskQuestion] : []), ...picks]
}

const bandWords: Record<Band, string> = {
  quick: "a quick, simple one",
  everyday: "everyday work of moderate difficulty",
  hard: "hard or many steps",
  image: "one with images to look at",
}

/** What the decision model reads about a model to tell it from the others. */
export function describeModel(candidate: Candidate) {
  const facts = [
    candidate.price === 0 ? "free" : `$${candidate.price.toFixed(2)} per million tokens`,
    `${Math.round(candidate.context / 1000)}K context`,
    candidate.reasons ? "reasons step by step" : "answers without reasoning",
    candidate.images ? "reads images" : undefined,
    candidate.released > 0 ? `released ${new Date(candidate.released).toISOString().slice(0, 7)}` : undefined,
  ]

  return `${candidate.name}: ${facts.filter((fact) => fact !== undefined).join(", ")}`
}

/**
 * The models the decision model may pick from for each kind of task, from those able to hold the prompt. Quick work
 * draws on the weaker, cheaper end of the pool, cheapest first; hard work on the strongest; everyday work on the
 * middle; prompts with images on the strongest image readers. Newer models come first among equals, a list keeps
 * to a few models and a provider to two of them, so the choice is real and short. A model set for a kind of task
 * in Settings is its whole list.
 */
export function shortlists(
  pool: readonly Candidate[],
  set: Partial<Record<Band, string>> | undefined,
  context: number,
): Lists {
  const fits = pool.filter((candidate) => candidate.context >= context)
  const usable = fits.length > 0 ? fits : pool
  const newest = (a: Candidate, b: Candidate) => b.released - a.released
  const list = (band: Band, keep: (candidate: Candidate) => boolean, sort: (a: Candidate, b: Candidate) => number) => {
    const named = pool.find((candidate) => candidate.key === set?.[band])

    if (named) return [named]

    // A band a small pool leaves empty takes the models nearest it; only images are a strict need.
    const kept = usable.filter(keep)

    return few((kept.length > 0 || band === "image" ? kept : usable).toSorted((a, b) => sort(a, b) || newest(a, b)))
  }

  return {
    quick: list("quick", (item) => item.strength <= 0.4, (a, b) => a.price - b.price),
    everyday: list(
      "everyday",
      (item) => item.strength >= 0.3 && item.strength <= 0.7,
      (a, b) => Math.abs(a.strength - 0.5) - Math.abs(b.strength - 0.5),
    ),
    hard: list("hard", (item) => item.strength >= 0.6, (a, b) => b.strength - a.strength),
    image: list("image", (item) => item.images, (a, b) => b.strength - a.strength),
  }
}

// At most SHORTLIST models, and at most PER_PROVIDER of one provider while others are there to choose from.
function few(sorted: readonly Candidate[]) {
  const providers = new Set(sorted.map((candidate) => candidate.ref.providerID)).size

  return sorted
    .filter(
      (candidate, index) =>
        providers === 1 ||
        sorted.slice(0, index).filter((other) => other.ref.providerID === candidate.ref.providerID).length <
          PER_PROVIDER,
    )
    .slice(0, SHORTLIST)
}

// A provider's own automatic model, which picks a model itself; Auto picking it would hand the choice away.
const ROUTER = /(^|\/)(auto|auto-model|auto-router|router)$/i

// Words in a model's name that say it is a vendor's stronger or lighter model.
const STRONGER = /\b(pro|max|ultra|opus|large|plus|sonnet|thinking|reasoner)\b/i
const LIGHTER = /\b(flash|mini|lite|nano|small|haiku|fast|air|tiny|instant)\b/i

/**
 * Catalog models as Auto's candidates, each with a strength from 0 to 1 among them: mostly its price rank, raised for
 * a model that reasons or is named as a vendor's stronger one, lowered for one named as lighter, and a little for
 * being newer. Price alone cannot tell free models apart; the other signals can.
 */
export function candidates(
  infos: readonly Pick_<
    Model.Info,
    "providerID" | "id" | "name" | "cost" | "capabilities" | "limit" | "time" | "compatibility" | "variants"
  >[],
): Candidate[] {
  const rank = (values: readonly number[], value: number) => {
    const below = values.filter((other) => other < value).length
    const same = values.filter((other) => other === value).length

    return values.length <= 1 ? 0.5 : (below + (same - 1) / 2) / (values.length - 1)
  }
  const prices = infos.map(price)
  const releases = infos.map((info) => info.time?.released ?? 0)

  const raw = infos.map((info) => {
    const reasons = info.compatibility?.reasoningField !== undefined || info.variants.length > 0
    const words = `${info.id} ${info.name}`.replaceAll(/[-_/.:]/g, " ")
    const hint = STRONGER.test(words) ? 0.15 : LIGHTER.test(words) ? -0.15 : 0

    return {
      info,
      reasons,
      score:
        0.6 * rank(prices, price(info)) +
        (reasons ? 0.15 : 0) +
        hint +
        0.1 * rank(releases, info.time?.released ?? 0),
    }
  })
  const scores = raw.map((item) => item.score)

  return raw.map((item) => ({
    ref: Model.Ref.make({ providerID: item.info.providerID, id: item.info.id }),
    key: `${item.info.providerID}/${item.info.id}`,
    name: item.info.name,
    images: item.info.capabilities.input.some((input) => input.startsWith("image")),
    price: price(item.info),
    context: item.info.limit.context,
    reasons: item.reasons,
    released: item.info.time?.released ?? 0,
    strength: rank(scores, item.score),
  }))
}

/** How much context a prompt needs at least: its own text, with room for the answer. */
function need(prompt: PromptInput.Prompt) {
  return Math.ceil(prompt.text.length / 3) + 8_000
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
