export * as UsageTool from "./usage.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Clock, Effect, Schema } from "effect"
import { UsageSubscription } from "../../usage-subscription.js"

// Fork feature: what the flat-rate subscriptions have used, as a tool. It reads the same allowances and 30-day
// history the session header and Settings show, and hands them back with a ready card for the app's inline visuals.

export const name = "usage"

export const description = `Get what the user's model subscriptions and prepaid accounts have used: each allowance (such as weekly input tokens, daily images, a spending limit or prepaid credits) with its limit and when it refills, and the last 30 days by model. Use this when the user asks about their usage, quota, limits, remaining tokens or which models they used most.`

export const Input = Schema.Struct({})

const Meter = Schema.Struct({
  unit: Schema.Literals(["input_tokens", "images", "usd"]),
  window: Schema.Literals(["daily", "weekly", "monthly", "total"]),
  used: Schema.Finite,
  limit: Schema.Finite,
  percent: Schema.Finite,
  resetsAt: Schema.optionalKey(Schema.Finite),
})

const ModelUsage = Schema.Struct({
  model: Schema.String,
  requests: Schema.Finite,
  input: Schema.Finite,
  output: Schema.Finite,
  cost: Schema.Finite,
})

export const Output = Schema.Struct({
  /** When this was read, in milliseconds since the Unix epoch; the card counts down to each refill from it. */
  asOf: Schema.Finite,
  providers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      active: Schema.Boolean,
      meters: Schema.Array(Meter),
      from: Schema.optionalKey(Schema.String),
      to: Schema.optionalKey(Schema.String),
      models: Schema.Array(ModelUsage),
    }),
  ),
})
export type Output = typeof Output.Type

// The card and the text list this many models; the rest are summed into one line.
const TOP_MODELS = 8

/** The allowances and the history of each provider as one entry, models busiest first. */
export function combine(input: {
  asOf: number
  subscriptions: readonly UsageSubscription.Info[]
  history: readonly UsageSubscription.History[]
}): Output {
  return {
    asOf: input.asOf,
    providers: input.subscriptions.map((subscription) => {
      const history = input.history.find((entry) => entry.providerID === subscription.providerID)

      return {
        name: subscription.name,
        active: subscription.active,
        meters: subscription.meters.map((meter) => ({
          ...meter,
          percent: meter.limit > 0 ? Math.round((meter.used / meter.limit) * 100) : 0,
        })),
        ...(history ? { from: history.from, to: history.to } : {}),
        models: (history?.models ?? [])
          .map((entry) => ({
            model: entry.model,
            requests: entry.requests,
            input: entry.tokens.input,
            output: entry.tokens.output,
            cost: entry.cost,
          }))
          .toSorted((a, b) => b.input + b.output - (a.input + a.output)),
      }
    }),
  }
}

/** The result as the short text the model reads. */
export function usageText(usage: Output) {
  const refill = (at: number | undefined) => (at === undefined ? "" : `, refills ${new Date(at).toISOString()}`)
  const count = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)

  return usage.providers
    .flatMap((provider) => [
      `${provider.name}${provider.active ? "" : " (subscription not active)"}`,
      ...provider.meters.map(
        (meter) =>
          meter.unit === "usd"
            ? `${meter.window === "total" ? "credits" : `${meter.window} spending limit`}: $${meter.used.toFixed(2)} of $${meter.limit.toFixed(2)} spent (${meter.percent}%)${refill(meter.resetsAt)}`
            : `${meter.window} ${meter.unit.replace("_", " ")}: ${count(meter.used)} of ${count(meter.limit)} (${meter.percent}%)${refill(meter.resetsAt)}`,
      ),
      ...(provider.from ? [`By model, ${provider.from} to ${provider.to}:`] : []),
      ...provider.models
        .slice(0, TOP_MODELS)
        .map(
          (entry) =>
            `${entry.model}: ${entry.requests} requests, ${count(entry.input)} in, ${count(entry.output)} out, $${entry.cost.toFixed(2)}`,
        ),
      ...(provider.models.length > TOP_MODELS ? [`and ${provider.models.length - TOP_MODELS} more models`] : []),
    ])
    .join("\n")
}

/** The ready-made block that shows the result as a card in the desktop app; see the weather tool's. */
export function cardHint(usage: Output) {
  return [
    "To show this as a usage card, put this block in your reply exactly as it is, fence included:",
    "```visual",
    `<usage-card><script type="application/json">${JSON.stringify(usage)}</script></usage-card>`,
    "```",
  ].join("\n")
}

export const Plugin = {
  id: "opencode.tool.usage",
  effect: Effect.fn("UsageTool.Plugin")(function* (ctx: Context) {
    const subscriptions = yield* UsageSubscription.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          // Called directly, as the weather tool is: the model must read the text result, which ends with the card.
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: () =>
            Effect.gen(function* () {
              const found = yield* subscriptions.list()

              if (found.length === 0)
                return yield* Effect.fail(new Error("No provider with a subscription that reports its usage is set up."))

              // The history is extra: the allowances still show when it cannot be read.
              const history = yield* subscriptions.history().pipe(Effect.catch(() => Effect.succeed([])))
              const output = combine({ asOf: yield* Clock.currentTimeMillis, subscriptions: found, history })

              return { output, content: `${usageText(output)}\n\n${cardHint(output)}` }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to read the subscription usage", error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
