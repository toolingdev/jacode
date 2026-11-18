import type { ConfigEntry, CredentialEntry } from "@opencode/client/promise"
import { Option, Schema } from "effect"

// Provider settings are open JSON; these are read as text or not at all.
const text = Schema.decodeUnknownOption(Schema.String)

// A key the config takes from the environment of the computer the server runs on, written `{env:NAME}`.
const ENV = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/

type Models = Record<string, { name?: string; images?: boolean }>

/**
 * One thing to do on a worker so it has a provider this computer has.
 * - `provider`: save an OpenAI-compatible provider the user added.
 * - `key`: store an API key for a provider.
 * - `env`: the same, for a key this computer reads from its environment; main resolves the variable first.
 * - `skip`: nothing can be copied, because the provider is signed in to rather than given a key.
 */
export type CopyStep =
  | {
      readonly type: "provider"
      readonly id: string
      readonly config: { name?: string; baseURL: string; models: Models; imageModels?: Models; imageBaseURL?: string }
    }
  | { readonly type: "key"; readonly id: string; readonly key: string }
  | { readonly type: "env"; readonly id: string; readonly variable: string }
  | { readonly type: "skip"; readonly id: string }

/**
 * What giving a worker this computer's providers takes, in order: each provider the user added before its key.
 * Only the global config counts, not a project's own. A key stored in the app wins over one written in the config.
 */
export function copyPlan(
  entries: readonly ConfigEntry[],
  credentials: readonly CredentialEntry[],
): readonly CopyStep[] {
  const boundary = entries.findIndex((entry) => entry.type === "directory")

  const providers = new Map(
    (boundary === -1 ? entries : entries.slice(0, boundary)).flatMap((entry) =>
      entry.type === "document" ? Object.entries(entry.info.providers ?? {}) : [],
    ),
  )

  const active = credentials.filter((entry) => entry.active)

  const named = (
    models: readonly (readonly [
      string,
      { readonly name?: string; readonly capabilities?: { readonly input?: readonly string[] } },
    ])[],
  ) =>
    Object.fromEntries(
      models.map(([model, config]) => [
        model,
        { name: config.name || undefined, images: config.capabilities?.input?.includes("image") ?? false },
      ]),
    )

  const defined = [...providers].flatMap(([id, provider]): CopyStep[] => {
    const baseURL = Option.getOrUndefined(text(provider.settings?.baseURL))
    const key = Option.getOrUndefined(text(provider.settings?.apiKey))
    const models = Object.entries(provider.models ?? {})
    const images = models.filter(([, config]) => config.type === "image")
    const imageBaseURL = Option.getOrUndefined(text(images[0]?.[1].settings?.baseURL))
    const variable = key ? ENV.exec(key)?.[1] : undefined

    return [
      ...(baseURL
        ? [
            {
              type: "provider" as const,
              id,
              config: {
                name: provider.name || undefined,
                baseURL,
                models: named(models.filter(([, config]) => config.type !== "image")),
                imageModels: images.length > 0 ? named(images) : undefined,
                imageBaseURL: images.length > 0 ? imageBaseURL : undefined,
              },
            },
          ]
        : []),
      ...(active.some((entry) => entry.integrationID === id) || !key
        ? []
        : [variable ? { type: "env" as const, id, variable } : { type: "key" as const, id, key }]),
    ]
  })

  return [
    ...defined,
    ...active.map(
      (entry): CopyStep =>
        entry.value.type === "key"
          ? { type: "key", id: entry.integrationID, key: entry.value.key }
          : { type: "skip", id: entry.integrationID },
    ),
  ]
}
