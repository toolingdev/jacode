export * as UsageSubscription from "./usage-subscription.js"

import { Money } from "@opencode/schema/money"
import { UsageSubscription } from "@opencode/schema/usage-subscription"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Integration } from "./integration.js"
import { Provider } from "./provider.js"

export const Info = UsageSubscription.Info
export type Info = UsageSubscription.Info

export const History = UsageSubscription.History
export type History = UsageSubscription.History

export const Included = UsageSubscription.Included
export type Included = UsageSubscription.Included

type Meter = UsageSubscription.Meter

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("UsageSubscription.UnavailableError", {
  message: Schema.String,
  service: Schema.String,
}) {}

export interface Interface {
  /** The subscription allowances of every loaded provider that reports them; empty when none does. */
  readonly list: () => Effect.Effect<readonly Info[], UnavailableError>
  /** What those providers recorded by model over the last 30 days, for the API key each is used with. */
  readonly history: () => Effect.Effect<readonly History[], UnavailableError>
  /** Fork feature: the models each subscription covers, so the rest can be marked as paid per use. */
  readonly included: () => Effect.Effect<readonly Included[], UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageSubscription") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient

    // Every enabled provider a reader knows, with that reader and the key the provider is used with: the configured
    // one, else the stored one.
    const subscribed = Effect.fnUntraced(function* () {
      const all = yield* providers.all()
      const found = yield* Effect.forEach(
        all.filter((provider) => provider.activation !== "disabled"),
        Effect.fnUntraced(function* (provider) {
          const reader = READERS.find((item) => item.matches(provider))

          if (!reader) return []
          const configured = provider.settings?.apiKey
          const key =
            typeof configured === "string" && configured !== "" ? configured : yield* storedKey(integrations, provider)
          return key ? [{ provider, key, reader }] : []
        }),
      )
      // Two providers on one account and key, such as a chat and an image endpoint, report the same plan once.
      return found.flat().filter((entry, index, all) =>
        all.findIndex((other) => other.reader === entry.reader && other.key === entry.key) === index,
      )
    })

    const list = Effect.fn("UsageSubscription.list")(function* () {
      const entries = yield* subscribed()
      return yield* readable(entries.map((entry) => entry.reader.usage(http, entry.provider, entry.key)))
    })

    const history = Effect.fn("UsageSubscription.history")(function* () {
      const to = yield* Clock.currentTimeMillis
      const days = { from: day(to - 29 * Duration.toMillis(Duration.days(1))), to: day(to) }
      const entries = yield* subscribed()
      return yield* readable(
        entries.flatMap((entry) => {
          const read = entry.reader.history

          return read ? [read(http, entry.provider, entry.key, days)] : []
        }),
      )
    })

    const included = Effect.fn("UsageSubscription.included")(function* () {
      const entries = yield* subscribed()
      return yield* readable(
        entries.flatMap((entry) => {
          const read = entry.reader.included

          return read ? [read(http, entry.provider, entry.key)] : []
        }),
      )
    })

    return Service.of({ list, history, included })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Provider.node, Integration.node, httpClient],
})

const timedOut = {
  duration: Duration.seconds(15),
  orElse: () => Effect.fail(new UnavailableError({ message: "Usage timed out", service: "usage" })),
}

/**
 * What the providers that answer report. One provider's failure, such as a wrong key, leaves the others' usage
 * readable; only when none answers is usage unavailable.
 */
function readable<A>(reads: readonly Effect.Effect<A, UnavailableError>[]) {
  return Effect.gen(function* () {
    if (reads.length === 0) return []
    const exits = yield* Effect.forEach(reads, Effect.exit, { concurrency: 4 })
    const read = exits.filter(Exit.isSuccess).map((exit) => exit.value)
    const failed = exits.find(Exit.isFailure)
    if (failed && read.length === 0) return yield* Effect.failCause(failed.cause)
    return read
  }).pipe(Effect.timeoutOrElse(timedOut))
}

/** The UTC day of an instant, as NanoGPT's usage API takes it. */
function day(millis: number) {
  return new Date(millis).toISOString().slice(0, 10)
}

const NANOGPT_HOST = "nano-gpt.com"
// Fixed rather than derived from the provider's baseURL, so the key is only ever sent to NanoGPT's own origin.
const NANOGPT_USAGE_URL = `https://${NANOGPT_HOST}/api/subscription/v1/usage`
const NANOGPT_HISTORY_URL = `https://${NANOGPT_HOST}/api/v1/usage`
const NANOGPT_INCLUDED_URL = `https://${NANOGPT_HOST}/api/subscription/v1/models`

// `GET /api/subscription/v1/models` lists the models the subscription covers, in the OpenAI list shape.
const NanoGPTIncluded = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

function readNanoGPTIncluded(http: HttpClient.HttpClient, provider: Provider.Info, key: string) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(NANOGPT_INCLUDED_URL).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(key),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(NanoGPTIncluded)),
      Effect.map((body): Included => ({ providerID: provider.id, models: body.data.map((model) => model.id) })),
      Effect.scoped,
      Effect.mapError(
        (error) =>
          new UnavailableError({ message: `NanoGPT models are unavailable: ${error.message}`, service: "nanogpt" }),
      ),
    )
}

/** Whether a provider's API is served from a host, judged from its base URL. */
function servedFrom(provider: Provider.Info, host: string) {
  const baseURL = provider.settings?.baseURL
  return typeof baseURL === "string" && URL.canParse(baseURL) && new URL(baseURL).hostname === host
}

/** The API key stored for the provider's integration, when the config doesn't carry one. */
function storedKey(integrations: Integration.Interface, provider: Provider.Info) {
  return Effect.gen(function* () {
    const connection = yield* integrations.connection.active(provider.integrationID ?? Integration.ID.make(provider.id))
    if (!connection) return undefined
    const credential = yield* integrations.connection
      .resolve(connection)
      .pipe(Effect.mapError((error) => new UnavailableError({ message: error.message, service: "usage" })))
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

// OpenRouter is paid per use from prepaid credits; a key may also carry its own spending limit. `GET /api/v1/key`
// describes the key that asks, and `GET /api/v1/credits` the account's balance.
const OPENROUTER_HOST = "openrouter.ai"
const OPENROUTER_KEY_URL = `https://${OPENROUTER_HOST}/api/v1/key`
const OPENROUTER_CREDITS_URL = `https://${OPENROUTER_HOST}/api/v1/credits`

const OpenRouterKey = Schema.Struct({
  data: Schema.Struct({
    usage: Schema.Finite,
    limit: Schema.optional(Schema.NullOr(Schema.Finite)),
    limit_reset: Schema.optional(Schema.NullOr(Schema.String)),
    usage_daily: Schema.optional(Schema.NullOr(Schema.Finite)),
    usage_weekly: Schema.optional(Schema.NullOr(Schema.Finite)),
    usage_monthly: Schema.optional(Schema.NullOr(Schema.Finite)),
  }),
})
const OpenRouterCredits = Schema.Struct({
  data: Schema.Struct({ total_credits: Schema.Finite, total_usage: Schema.Finite }),
})

/** The meters an OpenRouter key and account report: the key's spending limit, then the credits bought and spent. */
export function openRouterMeters(
  key: typeof OpenRouterKey.Type["data"],
  credits: typeof OpenRouterCredits.Type["data"] | undefined,
  now: number,
): Meter[] {
  const window: Meter["window"] =
    key.limit_reset === "daily" || key.limit_reset === "weekly" || key.limit_reset === "monthly" ? key.limit_reset : "total"
  const used =
    window === "daily" ? key.usage_daily : window === "weekly" ? key.usage_weekly : window === "monthly" ? key.usage_monthly : key.usage
  const limit = key.limit
  const reset = window === "total" ? undefined : nextReset(window, now)

  const spent = { unit: "usd" as const, window, used: used ?? key.usage, limit: limit ?? 0 }

  return [
    ...(limit ? [reset === undefined ? spent : { ...spent, resetsAt: reset }] : []),
    ...(credits && credits.total_credits > 0
      ? [{ unit: "usd" as const, window: "total" as const, used: credits.total_usage, limit: credits.total_credits }]
      : []),
  ]
}

/** When a daily, weekly or monthly limit next resets, at midnight UTC as OpenRouter resets them. */
export function nextReset(window: "daily" | "weekly" | "monthly", now: number) {
  const date = new Date(now)
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

  if (window === "daily") return midnight + Duration.toMillis(Duration.days(1))

  if (window === "weekly") return midnight + ((8 - date.getUTCDay()) % 7 || 7) * Duration.toMillis(Duration.days(1))

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

function openRouterGet<A>(http: HttpClient.HttpClient, url: string, key: string, schema: Schema.Codec<A, unknown>) {
  return HttpClient.withScope(http)
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(key)))
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.scoped,
    )
}

function readOpenRouter(http: HttpClient.HttpClient, provider: Provider.Info, key: string) {
  return Effect.gen(function* () {
    const info = yield* openRouterGet(http, OPENROUTER_KEY_URL, key, OpenRouterKey)
    // Some keys may not read the account's balance; the key's own limit still shows then.
    const credits = yield* openRouterGet(http, OPENROUTER_CREDITS_URL, key, OpenRouterCredits).pipe(
      Effect.map((body) => body.data),
      Effect.orElseSucceed(() => undefined),
    )
    const now = yield* Clock.currentTimeMillis

    return {
      providerID: provider.id,
      name: provider.name,
      active: true,
      meters: openRouterMeters(info.data, credits, now),
    } satisfies Info
  }).pipe(
    Effect.mapError(
      (error) => new UnavailableError({ message: `OpenRouter usage is unavailable: ${error.message}`, service: "openrouter" }),
    ),
  )
}

type Days = { readonly from: string; readonly to: string }

/**
 * How one provider reports what its plan or account has used. Each has a fixed host, so a key is only ever sent to
 * that provider's own origin; history and the models a plan covers are optional.
 */
type Reader = {
  readonly matches: (provider: Provider.Info) => boolean
  readonly usage: (http: HttpClient.HttpClient, provider: Provider.Info, key: string) => Effect.Effect<Info, UnavailableError>
  readonly history?: (
    http: HttpClient.HttpClient,
    provider: Provider.Info,
    key: string,
    days: Days,
  ) => Effect.Effect<History, UnavailableError>
  readonly included?: (
    http: HttpClient.HttpClient,
    provider: Provider.Info,
    key: string,
  ) => Effect.Effect<Included, UnavailableError>
}

const READERS: readonly Reader[] = [
  {
    matches: (provider) => servedFrom(provider, NANOGPT_HOST),
    usage: readNanoGPT,
    history: readNanoGPTHistory,
    included: readNanoGPTIncluded,
  },
  {
    matches: (provider) => servedFrom(provider, OPENROUTER_HOST) || provider.id === "openrouter",
    usage: readOpenRouter,
  },
]
