export * as UsageSubscription from "./usage-subscription.js"

import { Schema } from "effect"
import { Money } from "./money.js"
import { Provider } from "./provider.js"

const Instant = Schema.Finite.annotate({ description: "Milliseconds since the Unix epoch" })

/** One allowance of a provider subscription: an amount that refills when its window resets. */
export interface Meter extends Schema.Schema.Type<typeof Meter> {}
export const Meter = Schema.Struct({
  /** What the allowance counts: tokens, images, or money in US dollars (credits or a spending limit). */
  unit: Schema.Literals(["input_tokens", "images", "usd"]),
  /** How often the allowance refills; `total` never does, as with prepaid credits. */
  window: Schema.Literals(["daily", "weekly", "monthly", "total"]),
  used: Schema.Finite,
  limit: Schema.Finite,
  /** When the allowance refills; absent for one that never does. */
  resetsAt: Instant.pipe(Schema.optionalKey),
}).annotate({ identifier: "UsageSubscription.Meter" })

/** What a configured provider's plan or account has used of its allowances: a subscription's, or prepaid credits. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  providerID: Provider.ID,
  name: Schema.String,
  /** The subscription is in good standing; the provider refuses subscription requests while it is not. */
  active: Schema.Boolean,
  meters: Schema.Array(Meter),
}).annotate({ identifier: "UsageSubscription.Info" })

/** What one model served over a history's days. */
export interface ModelUsage extends Schema.Schema.Type<typeof ModelUsage> {}
export const ModelUsage = Schema.Struct({
  /** The model as the provider names it, which need not be an ID OpenCode knows. */
  model: Schema.String,
  requests: Schema.Finite,
  tokens: Schema.Struct({ input: Schema.Finite, output: Schema.Finite }),
  /** What the requests cost after refunds; zero for requests the subscription covered. */
  cost: Money.USD,
}).annotate({ identifier: "UsageSubscription.ModelUsage" })

/** What a provider recorded for the API key OpenCode uses, by model. Other keys of the same account are not counted. */
export interface History extends Schema.Schema.Type<typeof History> {}
export const History = Schema.Struct({
  providerID: Provider.ID,
  name: Schema.String,
  /** The first and last day counted, as UTC `YYYY-MM-DD`. */
  from: Schema.String,
  to: Schema.String,
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "UsageSubscription.History" })

/** Fork feature: the models a provider's subscription covers; any other model of the provider is paid per use. */
export interface Included extends Schema.Schema.Type<typeof Included> {}
export const Included = Schema.Struct({
  providerID: Provider.ID,
  /** Model IDs as the provider names them, which are the IDs OpenCode lists for it. */
  models: Schema.Array(Schema.String),
}).annotate({ identifier: "UsageSubscription.Included" })
