export * as UsageSubscription from "./usage-subscription.js"

import { Money } from "@opencode/schema/money"
import { UsageSubscription } from "@opencode/schema/usage-subscription"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Clock, Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Integration } from "./integration.js"
import { Provider } from "./provider.js"

export const Info = UsageSubscription.Info
export type Info = UsageSubscription.Info

export const History = UsageSubscription.History
export type History = UsageSubscription.History

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("UsageSubscription.UnavailableError", {
  message: Schema.String,
  service: Schema.String,
}) {}

export interface Interface {
  /** The subscription allowances of every loaded provider that reports them; empty when none does. */
  readonly list: () => Effect.Effect<readonly Info[], UnavailableError>
  /** What those providers recorded by model over the last 30 days, for the API key each is used with. */
  readonly history: () => Effect.Effect<readonly History[], UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageSubscription") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient

    // Every enabled NanoGPT provider with the key it is used with: the configured one, else the stored one.
    const subscribed = Effect.fnUntraced(function* () {
      const all = yield* providers.all()
      const found = yield* Effect.forEach(
        all.filter((provider) => provider.activation !== "disabled" && isNanoGPT(provider)),
        Effect.fnUntraced(function* (provider) {
          const configured = provider.settings?.apiKey
          const key =
            typeof configured === "string" && configured !== "" ? configured : yield* storedKey(integrations, provider)
          return key ? [{ provider, key }] : []
        }),
      )
      return found.flat()
    })

    const list = Effect.fn("UsageSubscription.list")(function* () {
      const entries = yield* subscribed()
      return yield* Effect.forEach(entries, (entry) => readNanoGPT(http, entry.provider, entry.key), {
        concurrency: 4,
      }).pipe(Effect.timeoutOrElse(timedOut))
    })

    const history = Effect.fn("UsageSubscription.history")(function* () {
      const to = yield* Clock.currentTimeMillis
      const days = { from: day(to - 29 * Duration.toMillis(Duration.days(1))), to: day(to) }
      const entries = yield* subscribed()
      return yield* Effect.forEach(entries, (entry) => readNanoGPTHistory(http, entry.provider, entry.key, days), {
        concurrency: 4,
      }).pipe(Effect.timeoutOrElse(timedOut))
    })

    return Service.of({ list, history })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Provider.node, Integration.node, httpClient],
})

const timedOut = {
  duration: Duration.seconds(15),
  orElse: () => Effect.fail(new UnavailableError({ message: "NanoGPT usage timed out", service: "nanogpt" })),
}

/** The UTC day of an instant, as NanoGPT's usage API takes it. */
function day(millis: number) {
  return new Date(millis).toISOString().slice(0, 10)
}

const NANOGPT_HOST = "nano-gpt.com"
// Fixed rather than derived from the provider's baseURL, so the key is only ever sent to NanoGPT's own origin.
const NANOGPT_USAGE_URL = `https://${NANOGPT_HOST}/api/subscription/v1/usage`
const NANOGPT_HISTORY_URL = `https://${NANOGPT_HOST}/api/v1/usage`

function isNanoGPT(provider: Provider.Info) {
  const baseURL = provider.settings?.baseURL
  return typeof baseURL === "string" && URL.canParse(baseURL) && new URL(baseURL).hostname === NANOGPT_HOST
}

/** The API key stored for the provider's integration, when the config doesn't carry one. */
function storedKey(integrations: Integration.Interface, provider: Provider.Info) {
  return Effect.gen(function* () {
    const connection = yield* integrations.connection.active(provider.integrationID ?? Integration.ID.make(provider.id))
    if (!connection) return undefined
    const credential = yield* integrations.connection
      .resolve(connection)
      .pipe(Effect.mapError((error) => new UnavailableError({ message: error.message, service: "nanogpt" })))
    return credential?.type === "key" ? credential.key : undefined
  })
}

// One allowance as `GET /api/subscription/v1/usage` describes it. `percentUsed` there is a 0-1 fraction; it is
// derivable from `used` and the limit, so it is not read.
const Allowance = Schema.Struct({ used: Schema.Finite, resetAt: Schema.Finite })
const NanoGPTUsage = Schema.Struct({
  active: Schema.Boolean,
  limits: Schema.Struct({
    weeklyInputTokens: Schema.optional(Schema.NullOr(Schema.Finite)),
    dailyInputTokens: Schema.optional(Schema.NullOr(Schema.Finite)),
    dailyImages: Schema.optional(Schema.NullOr(Schema.Finite)),
  }),
  weeklyInputTokens: Schema.optional(Schema.NullOr(Allowance)),
  dailyInputTokens: Schema.optional(Schema.NullOr(Allowance)),
  dailyImages: Schema.optional(Schema.NullOr(Allowance)),
})

// A plan without an allowance reports it as null, in `limits` and at the top level.
const meters = [
  { key: "weeklyInputTokens", unit: "input_tokens", window: "weekly" },
  { key: "dailyInputTokens", unit: "input_tokens", window: "daily" },
  { key: "dailyImages", unit: "images", window: "daily" },
] as const

function readNanoGPT(http: HttpClient.HttpClient, provider: Provider.Info, key: string) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(NANOGPT_USAGE_URL).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(key)),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(NanoGPTUsage)),
      Effect.map(
        (body): Info => ({
          providerID: provider.id,
          name: provider.name,
          active: body.active,
          meters: meters.flatMap((meter) => {
            const allowance = body[meter.key]
            const limit = body.limits[meter.key]
            if (!allowance || !limit) return []
            return [
              { unit: meter.unit, window: meter.window, used: allowance.used, limit, resetsAt: allowance.resetAt },
            ]
          }),
        }),
      ),
      Effect.scoped,
      Effect.mapError(
        (error) =>
          new UnavailableError({ message: `NanoGPT usage is unavailable: ${error.message}`, service: "nanogpt" }),
      ),
    )
}

// `GET /api/v1/usage` counts only the key that asks (`scope: "current_key"`); it has no account-wide scope.
const NanoGPTHistory = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  byModel: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      requests: Schema.Finite,
      netCostUsd: Schema.Finite,
      inputTokens: Schema.Finite,
      outputTokens: Schema.Finite,
    }),
  ),
})

function readNanoGPTHistory(
  http: HttpClient.HttpClient,
  provider: Provider.Info,
  key: string,
  days: { readonly from: string; readonly to: string },
) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${NANOGPT_HISTORY_URL}?from=${days.from}&to=${days.to}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(key),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(NanoGPTHistory)),
      Effect.map(
        (body): History => ({
          providerID: provider.id,
          name: provider.name,
          from: body.from,
          to: body.to,
          models: body.byModel.map((entry) => ({
            model: entry.model,
            requests: entry.requests,
            tokens: { input: entry.inputTokens, output: entry.outputTokens },
            cost: Money.USD.make(entry.netCostUsd),
          })),
        }),
      ),
      Effect.scoped,
      Effect.mapError(
        (error) =>
          new UnavailableError({ message: `NanoGPT usage is unavailable: ${error.message}`, service: "nanogpt" }),
      ),
    )
}
