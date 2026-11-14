export * as ConfigCustomProvider from "./custom-provider.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

/**
 * A provider that speaks the OpenAI chat API at its own URL, as a client's "add custom provider" form describes it.
 * Its API key is not part of it: store the key as the credential of the integration with the provider's ID.
 */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  /** Display name; the provider's ID when omitted. */
  name: Schema.String.pipe(optional),
  baseURL: Schema.String,
  /** The models to offer, by the ID the provider knows each by. */
  models: Schema.Record(Schema.String, Schema.Struct({ name: Schema.String.pipe(optional) })),
}).annotate({ identifier: "Config.CustomProvider" })
