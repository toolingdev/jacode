import type { ConfigEntry, IntegrationInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"

// Provider settings are open JSON; these two are read as text or not at all.
const text = Schema.decodeUnknownOption(Schema.String)

/** Where a provider's API key comes from, most specific first. */
export type KeySource = "stored" | "environment" | "config" | "missing"

/** One config-defined provider as the settings page lists it. */
export type ProviderRow = {
  readonly id: string
  readonly name: string | undefined
  readonly baseURL: string | undefined
  /** Chat model IDs with their display names; an empty name means the ID is shown. */
  readonly models: Readonly<Record<string, string>>
  /** Image model IDs with their display names. */
  readonly imageModels: Readonly<Record<string, string>>
  /** Where the image models' API lives, when it is not the provider's base URL. */
  readonly imageBaseURL: string | undefined
  readonly key: KeySource
}

/**
 * The providers the location's config documents define, by ID. A later document's definition of an ID replaces an
 * earlier one's, as config precedence does. `integrations` says whether a key is stored or comes from the environment.
 */
export function providerRows(
  entries: readonly ConfigEntry[],
  integrations: readonly IntegrationInfo[],
): readonly ProviderRow[] {
  const defined = new Map(
    entries.flatMap((entry) => (entry.type === "document" ? Object.entries(entry.info.providers ?? {}) : [])),
  )

  return [...defined]
    .map(([id, provider]) => {
      const connections = integrations.find((integration) => integration.id === id)?.connections ?? []
      const configured = Option.getOrUndefined(text(provider.settings?.apiKey))
      const models = Object.entries(provider.models ?? {})
      const images = models.filter(([, config]) => config.type === "image")

      return {
        id,
        name: provider.name,
        baseURL: Option.getOrUndefined(text(provider.settings?.baseURL)),
        models: named(models.filter(([, config]) => config.type !== "image")),
        imageModels: named(images),
        imageBaseURL: Option.getOrUndefined(text(images[0]?.[1].settings?.baseURL)),
        key: connections.some((connection) => connection.type === "credential")
          ? ("stored" as const)
          : connections.some((connection) => connection.type === "env")
            ? ("environment" as const)
            : configured
              ? ("config" as const)
              : ("missing" as const),
      }
    })
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

function named(models: readonly (readonly [string, { readonly name?: string }])[]) {
  return Object.fromEntries(models.map(([model, config]) => [model, config.name ?? ""]))
}
