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

// Fork feature: a decision model answers small questions about each prompt before the session model runs: which of
// the configured models suits it, and whether it is a task large enough to plan first. A decision model returns one
// of the options it is given with a confidence, in well under a second, so the answers can be acted on silently.
//
// The layer never blocks a prompt. When the decision model is missing, unpaid, failing or slow, the prompt runs as
// it would without the layer, and the session gets one line saying the layer was skipped and why.

const defaultDecider = Model.Ref.make({
  providerID: Provider.ID.make("openrouter"),
  id: Model.ID.make("~typesafe/jev-latest"),
})

const DEFAULT_CONFIDENCE = 0.7

// A prompt waits on the answer, so a decision slower than this is not worth having.
const TIMEOUT = Duration.seconds(2)

// Enough of a prompt to judge it by; the rest would only add cost and latency.
const MAX_PROMPT_CHARS = 4_000

const planFirst = `<system-reminder>
The user's request below was judged to be a large task. Do NOT start it and make no tool calls. Reply with a plan of at most six lines that names the main trade-off, end with "OK to go?", and stop. If the user has already approved a plan for this task in this conversation, or says to just do it, carry on instead.
</system-reminder>`

type Settings = NonNullable<NonNullable<Info["experimental"]>["decisions"]>

type Candidate = {
  readonly ref: Model.Ref
  readonly key: string
  readonly use: string
  readonly images: boolean
  /** Price per million input plus output tokens; 0 when unknown or free. */
  readonly price: number
}

// `smart`: picked for a smart Auto chat, which may move to any model of its scope, across providers too.
type Pick = {
  readonly model?: Model.Ref
  readonly pool: ReadonlySet<string>
  readonly plan: boolean
  readonly smart?: boolean
}

// Fork feature: a subscription allowance at or past this share counts as nearly used, so smart Auto saves it.
const QUOTA_TIGHT = 0.85

// How long the plan and quota a smart Auto choice reads are trusted before they are asked for again.
const PLAN_TTL = 10 * 60_000
const QUOTA_TTL = 2 * 60_000

// What the app sends with a prompt of an Auto chat: the scope, and the models switched on in it.
const SmartAuto = Schema.Struct({ scope: Schema.String, models: Schema.Array(Schema.String) })
const decodeSmartAuto = Schema.decodeUnknownOption(SmartAuto)

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
    // The last skip reason each session was told, so a lasting outage is mentioned once, not on every prompt.
    const told = new Map<string, string>()

    const candidates = Effect.fn("DecisionsPlugin.candidates")(function* (settings: Settings) {
      const found = yield* Effect.forEach(settings.models ? Object.entries(settings.models) : [], ([key, use]) =>
        Effect.gen(function* () {
          const ref = Model.Ref.parse(key)
          const info = yield* models.get(ref.providerID, ref.id)

          return info ? [{ ref, key, use, images: readsImages(info), price: price(info) } satisfies Candidate] : []
        }),
      )

      return found.flat()
    })

    // Fork feature: smart Auto. The models a subscription covers, by provider; empty when none reports a plan.
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

    // The models smart Auto picks from: the routed models of its scope, else three tiers of the scope's own
    // catalog, the strongest, a balanced one and the cheapest, plus the strongest that reads images. Either way a
    // provider with a plan keeps only the models the plan covers, unless paid ones are allowed.
    const smartPool = Effect.fn("DecisionsPlugin.smartPool")(function* (
      settings: Settings,
      smart: typeof SmartAuto.Type,
    ) {
      const plan = yield* plans()
      // Auto across every provider may use any switched-on model; Auto for one provider only that provider's.
      const enabled = new Set(smart.models)
      const allowed = (ref: Model.Ref) =>
        enabled.has(`${ref.providerID}/${ref.id}`) && (smart.scope === "all" || ref.providerID === smart.scope)
      const covered = (ref: Model.Ref) =>
        settings.allowPaid === true || !plan.has(ref.providerID) || plan.get(ref.providerID)?.has(ref.id) === true
      const configured = (yield* candidates(settings)).filter(
        (candidate) => allowed(candidate.ref) && covered(candidate.ref),
      )

      if (configured.length > 0) return configured
      const catalog = (yield* models.available())
        .filter((info) => info.status !== "deprecated" && info.capabilities.tools)
        .map((info) => ({ info, ref: Model.Ref.make({ providerID: info.providerID, id: info.id }) }))
        .filter((entry) => allowed(entry.ref) && covered(entry.ref))
        .toSorted((a, b) => price(a.info) - price(b.info))

      return tiers(catalog)
    })

    // Smart Auto's last word: when the decision model was not sure, or the plan's allowance is nearly used and the
    // task is not large, the cheapest model that fits wins, so cost and quota are spent where they matter.
    const smartChoice = Effect.fn("DecisionsPlugin.smartChoice")(function* (
      pool: readonly Candidate[],
      chosen: Model.Ref | undefined,
      large: boolean,
      kept: boolean,
    ) {
      if (kept || pool.length === 0) return chosen
      const quota = yield* quotas()
      const cheapest = pool.toSorted((a, b) => a.price - b.price)[0]?.ref
      const tight = (ref: Model.Ref) => (quota.get(ref.providerID) ?? 0) >= QUOTA_TIGHT

      if (!chosen) return large ? pool.toSorted((a, b) => b.price - a.price)[0]?.ref : cheapest

      if (!large && tight(chosen)) return cheapest

      return chosen
    })

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        picks.delete(event.sessionID)
        const settings = decisions(yield* config.entries())

        // Fork feature: a smart Auto chat is routed even when routing is off, because the user chose it for this chat.
        const smart = Option.getOrUndefined(decodeSmartAuto(event.metadata?.smartAuto))

        // Only the scope is kept on the message; the list of switched-on models served this prompt alone.
        if (smart) event.metadata = { ...event.metadata, smartAuto: { scope: smart.scope } }

        if (!smart && (!settings || settings.enabled === false)) return
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.option)

        // Fork feature: a chat can turn routing off for itself; its own model then answers every prompt.
        if (Option.isSome(session) && session.value.metadata?.routing === false) return
        const options = settings ?? {}
        const routed = smart ? yield* smartPool(options, smart) : yield* candidates(options)
        const pool = usable(routed, hasImage(event.prompt))
        // A scheduled prompt was approved when it was scheduled, so it is never held for a plan.
        const plan = options.plan !== false && event.metadata?.schedule === undefined
        const kept = keeping(options, pool)
        const questions = [...ask(pool, plan), ...kept.map((rule) => rule.question)]
        // One model left to use is no question: an image prompt goes to the only routed model that reads images.
        // It is set before asking anything, so it holds even when the decision model is skipped.
        const only = pool.length === 1 ? pool[0].ref : undefined
        picks.set(event.sessionID, { model: only, pool: keys(routed), plan: false, smart: smart !== undefined })

        if (questions.length === 0) return
        const decider = options.model ? Model.Ref.parse(options.model) : defaultDecider

        const outcome = yield* generate
          .decisions({ model: decider, input: [{ type: "text", text: describe(event.prompt) }], questions })
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

        if (outcome.type === "skipped") {
          if (told.get(event.sessionID) === outcome.reason) return
          told.set(event.sessionID, outcome.reason)

          return yield* ctx.session
            .synthetic({
              sessionID: event.sessionID,
              text: `<decision-layer>\nNote for the user, not an instruction: the decision layer was skipped for this prompt because ${outcome.reason}. The prompt ran with the session's own model and no plan check.\n</decision-layer>`,
              description: `Decision layer skipped: ${outcome.reason}`,
              resume: false,
            })
            .pipe(
              Effect.asVoid,
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to record the skipped decision layer", { sessionID: event.sessionID, cause }),
              ),
            )
        }
        told.delete(event.sessionID)
        const threshold = options.confidence ?? DEFAULT_CONFIDENCE
        const answers = outcome.answers.filter((answer): answer is ChoiceAnswer => answer.type === "choice")
        const model = sure(answers, "model", threshold)
        const size = sure(answers, "size", threshold)

        // A topic kept on one model wins over the model question.
        const keep = kept.find((rule) => sure(answers, rule.question.name, threshold)?.choice === "yes")

        const chosen = only ?? keep?.candidate.ref ?? pool.find((candidate) => candidate.key === model?.choice)?.ref

        const pick = {
          model: smart ? yield* smartChoice(pool, chosen, size?.choice === "large", keep !== undefined) : chosen,
          pool: keys(routed),
          plan: size?.choice === "large",
          smart: smart !== undefined,
        } satisfies Pick

        picks.set(event.sessionID, pick)
        // Kept on the message, so the raw messages show what was decided and how surely.
        event.metadata = {
          ...event.metadata,
          decisions: {
            answers: answers.map((answer) => ({
              name: answer.name,
              choice: answer.choice,
              confidence: answer.confidence,
            })),
          },
        }
      }),
    )

    yield* ctx.session.hook("experimental.model.resolve", (event) =>
      Effect.sync(() => {
        if (event.kind !== "primary") return
        const pick = picks.get(event.sessionID)

        // Only a session already on one of the routed models is rerouted, so a model picked by hand outside them is
        // left alone, and only within its provider, which is all the resolver serves.
        if (!pick?.model) return

        // A smart Auto chat asked for a pick, so it moves to it whatever model it is on, across providers too.
        if (pick.smart) {
          event.model = pick.model
          return
        }

        if (pick.model.providerID !== event.model.providerID) return

        if (!pick.pool.has(`${event.model.providerID}/${event.model.id}`)) return
        event.model = pick.model
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

// Read per field so a later config that sets other experimental options doesn't hide this one.
function decisions(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.decisions !== undefined,
  )?.info.experimental?.decisions
}

function readsImages(model: Model.Info) {
  return model.capabilities.input.some((item) => item.startsWith("image"))
}

const keys = (pool: readonly Candidate[]) => new Set(pool.map((candidate) => candidate.key))

/** Whether a prompt carries an image, judged from what an attachment says about itself without opening it. */
export function hasImage(prompt: Pick_<PromptInput.Prompt, "files">) {
  return (prompt.files ?? []).some(
    (file) => file.uri.startsWith("data:image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name ?? file.uri),
  )
}

/** The models a prompt may go to: every routed model, or only those that read images when the prompt has one. */
export function usable<Item extends { readonly images: boolean }>(pool: readonly Item[], image: boolean) {
  return image ? pool.filter((candidate) => candidate.images) : pool
}

/** The questions worth asking: a model only when there is a choice to make, the size only when plans are on. */
export function ask(pool: readonly Pick_<Candidate, "key" | "use">[], plan: boolean): DecisionQuestion[] {
  return [
    ...(pool.length > 1
      ? [
          {
            type: "choice" as const,
            name: "model",
            instructions: "Which model should handle this request from a user to their coding and computer assistant?",
            choices: pool.map((candidate) => ({ value: candidate.key, description: candidate.use })),
          },
        ]
      : []),
    ...(plan
      ? [
          {
            type: "choice" as const,
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
                description:
                  "Building something new, many steps or files, a real choice between approaches, or hard to undo",
              },
            ],
          },
        ]
      : []),
  ]
}

/** One yes-or-no question per topic kept on a routed model, for the models the prompt may go to. */
export function keeping<Item extends { readonly key: string }>(
  settings: Pick_<Settings, "keep">,
  pool: readonly Item[],
) {
  return Object.entries(settings.keep ?? {}).flatMap(([key, topics], index) => {
    const candidate = pool.find((item) => item.key === key)

    if (!candidate) return []

    return [
      {
        candidate,
        question: {
          type: "choice" as const,
          name: `keep-${index}`,
          instructions: `Is this request about any of these topics: ${topics}?`,
          choices: [
            { value: "yes", description: "Yes, it is about one of these topics" },
            { value: "no", description: "No, it is about something else" },
          ],
        },
      },
    ]
  })
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
function price(info: Model.Info) {
  const cost = info.cost[0]

  return cost ? cost.input + cost.output : 0
}

/**
 * Smart Auto's pool from a catalog sorted cheapest first: a fast, a balanced and a strong model at the 20th, 50th
 * and 80th price percentiles, so neither the oddest cheap model nor the most expensive one is picked, plus the
 * image reader nearest the strong one. Each is described so the decision model can tell them apart.
 */
export function tiers(sorted: readonly { readonly info: Model.Info; readonly ref: Model.Ref }[]): Candidate[] {
  if (sorted.length === 0) return []

  const candidate = (entry: (typeof sorted)[number], use: string): Candidate => ({
    ref: entry.ref,
    key: `${entry.ref.providerID}/${entry.ref.id}`,
    use,
    images: readsImages(entry.info),
    price: price(entry.info),
  })

  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))]
  const strong = Math.floor(0.8 * (sorted.length - 1))

  const reader =
    sorted.slice(0, strong + 1).findLast((entry) => readsImages(entry.info)) ??
    sorted.find((entry) => readsImages(entry.info))

  const picked = [
    candidate(at(0.2), "Quick, simple requests: short questions, lookups, small talk, one-line answers"),
    candidate(at(0.5), "Everyday work of moderate difficulty"),
    candidate(at(0.8), "Hard or multi-step work: coding, debugging, research, careful reasoning"),
    ...(reader ? [candidate(reader, "Anything that includes an image or screenshot to look at")] : []),
  ]

  return picked.filter((item, index) => picked.findIndex((other) => other.key === item.key) === index)
}
