export * as ConfigCustomProvider from "./custom-provider.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

const Model = Schema.Struct({
  name: Schema.String.pipe(optional),
  /**
   * The model accepts image input: a chat model that can look at images, or an image model that can edit them or use
   * them as references. Defaults to false, so a text-only model is never sent an image it would refuse.
   */
  images: Schema.Boolean.pipe(optional),
})

/**
 * A provider that speaks the OpenAI chat API at its own URL, as a client's "add custom provider" form describes it.
 * Its API key is not part of it: store the key as the credential of the integration with the provider's ID.
 */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  /** Display name; the provider's ID when omitted. */
  name: Schema.String.pipe(optional),
  baseURL: Schema.String,
  /** The chat models to offer, by the ID the provider knows each by. */
  models: Schema.Record(Schema.String, Model),
  /** The image models to offer through the provider's OpenAI-compatible images API. */
  imageModels: Schema.Record(Schema.String, Model).pipe(optional),
  /** Where the images API lives when it is not under `baseURL`. */
  imageBaseURL: Schema.String.pipe(optional),
}).annotate({ identifier: "Config.CustomProvider" })
