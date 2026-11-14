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
  /** Model IDs with their display names; an empty name means the ID is shown. */
  readonly models: Readonly<Record<string, string>>
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

      return {
        id,
        name: provider.name,
        baseURL: Option.getOrUndefined(text(provider.settings?.baseURL)),
        models: Object.fromEntries(
          Object.entries(provider.models ?? {}).map(([model, config]) => [model, config.name ?? ""]),
        ),
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
