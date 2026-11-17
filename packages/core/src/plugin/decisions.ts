export * as DecisionsPlugin from "./decisions.js"

import { Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { Document, Entry, Info } from "@opencode/schema/config"
import type { ChoiceAnswer, DecisionQuestion } from "@opencode/schema/generate"
import type { PromptInput } from "@opencode/schema/prompt-input"
import { Duration, Effect, Option } from "effect"
import { Config } from "../config.js"
import { Generate } from "../generate.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
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

type Candidate = { readonly ref: Model.Ref; readonly key: string; readonly use: string; readonly images: boolean }

type Pick = { readonly model?: Model.Ref; readonly pool: ReadonlySet<string>; readonly plan: boolean }

export const Plugin = define({
  id: "opencode.decisions",
  effect: Effect.fn("DecisionsPlugin")(function* (ctx) {
    const config = yield* Config.Service
    const generate = yield* Generate.Service
    const models = yield* Model.Service
    // What the latest prompt of each session was routed to; a new prompt replaces it.
    const picks = new Map<string, Pick>()
    // The last skip reason each session was told, so a lasting outage is mentioned once, not on every prompt.
    const told = new Map<string, string>()

    const candidates = Effect.fn("DecisionsPlugin.candidates")(function* (settings: Settings) {
      const found = yield* Effect.forEach(settings.models ? Object.entries(settings.models) : [], ([key, use]) =>
        Effect.gen(function* () {
          const ref = Model.Ref.parse(key)
          const info = yield* models.get(ref.providerID, ref.id)

          return info ? [{ ref, key, use, images: readsImages(info) } satisfies Candidate] : []
        }),
      )

      return found.flat()
    })

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        picks.delete(event.sessionID)
        const settings = decisions(yield* config.entries())

        if (!settings || settings.enabled === false) return
        const routed = yield* candidates(settings)
        const pool = usable(routed, hasImage(event.prompt))
        // A scheduled prompt was approved when it was scheduled, so it is never held for a plan.
        const plan = settings.plan !== false && event.metadata?.schedule === undefined
        const questions = ask(pool, plan)
        // One model left to use is no question: an image prompt goes to the only routed model that reads images.
        // It is set before asking anything, so it holds even when the decision model is skipped.
        const only = pool.length === 1 ? pool[0].ref : undefined
        picks.set(event.sessionID, { model: only, pool: keys(routed), plan: false })

        if (questions.length === 0) return
        const decider = settings.model ? Model.Ref.parse(settings.model) : defaultDecider

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
        const threshold = settings.confidence ?? DEFAULT_CONFIDENCE
        const answers = outcome.answers.filter((answer): answer is ChoiceAnswer => answer.type === "choice")
        const model = sure(answers, "model", threshold)
        const size = sure(answers, "size", threshold)

        const pick = {
          model: only ?? pool.find((candidate) => candidate.key === model?.choice)?.ref,
          pool: keys(routed),
          plan: size?.choice === "large",
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
        if (!pick?.model || pick.model.providerID !== event.model.providerID) return

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
