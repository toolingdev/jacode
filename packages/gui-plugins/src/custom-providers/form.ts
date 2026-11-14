import type { ExperimentalConfigProviderSetInput } from "@opencode/client/promise"

/** The custom provider form as the user typed it. */
export type ProviderForm = {
  readonly id: string
  readonly name: string
  readonly baseURL: string
  readonly key: string
  readonly models: string
  readonly imageModels: string
  readonly imageBaseURL: string
}

/** What is wrong with one field, as an i18n key suffix under `error.`. */
export type ProviderFormErrors = {
  readonly id?: "id.required" | "id.invalid" | "id.taken" | undefined
  readonly baseURL?: "baseURL.invalid" | undefined
  readonly models?: "models.required" | "models.invalid" | undefined
  readonly imageModels?: "models.invalid" | undefined
  readonly imageBaseURL?: "baseURL.invalid" | undefined
}

export type ProviderFormResult =
  | {
      readonly ok: true
      readonly config: ExperimentalConfigProviderSetInput
      /** The API key to store, when the user typed one. */
      readonly key: string | undefined
    }
  | { readonly ok: false; readonly errors: ProviderFormErrors }

/** One saved model as the form shows it: its display name, empty for none, and whether it accepts image input. */
export type ModelEntry = { readonly name: string; readonly images: boolean }

export const emptyProviderForm: ProviderForm = {
  id: "",
  name: "",
  baseURL: "",
  key: "",
  models: "",
  imageModels: "",
  imageBaseURL: "",
}

/** A saved provider as the form shows it for editing. The key is never read back. */
export function providerForm(
  id: string,
  provider: {
    readonly name?: string
    readonly baseURL?: string
    readonly models: Readonly<Record<string, ModelEntry>>
    readonly imageModels: Readonly<Record<string, ModelEntry>>
    readonly imageBaseURL?: string
  },
): ProviderForm {
  const lines = (models: Readonly<Record<string, ModelEntry>>, tag: string) =>
    Object.entries(models)
      .map(([model, entry]) => `${entry.name ? `${model} = ${entry.name}` : model}${entry.images ? ` [${tag}]` : ""}`)
      .join("\n")

  return {
    id,
    name: provider.name ?? "",
    baseURL: provider.baseURL ?? "",
    key: "",
    models: lines(provider.models, "vision"),
    imageModels: lines(provider.imageModels, "edit"),
    imageBaseURL: provider.imageBaseURL ?? "",
  }
}

/**
 * The provider a filled form describes, or what to fix. `taken` lists the IDs a new provider cannot use; pass none
 * when editing, since saving an ID again replaces it.
 */
export function readProviderForm(form: ProviderForm, taken: readonly string[]): ProviderFormResult {
  const id = form.id.trim()

  const idError = !id
    ? "id.required"
    : !/^[a-z0-9][a-z0-9-]*$/.test(id)
      ? "id.invalid"
      : taken.includes(id)
        ? "id.taken"
        : undefined

  const baseURL = form.baseURL.trim()
  const imageBaseURL = form.imageBaseURL.trim()
  const models = modelLines(form.models)
  const imageModels = modelLines(form.imageModels)
  // A provider may offer only image models, so one list may be empty but not both.
  const none = models && imageModels && Object.keys(models).length + Object.keys(imageModels).length === 0
  const modelsError = !models ? "models.invalid" : none ? "models.required" : undefined

  if (
    idError ||
    !httpURL(baseURL) ||
    !models ||
    modelsError ||
    !imageModels ||
    (imageBaseURL && !httpURL(imageBaseURL))
  )
    return {
      ok: false,
      errors: {
        id: idError,
        baseURL: httpURL(baseURL) ? undefined : "baseURL.invalid",
        models: modelsError,
        imageModels: imageModels ? undefined : "models.invalid",
        imageBaseURL: !imageBaseURL || httpURL(imageBaseURL) ? undefined : "baseURL.invalid",
      },
    }

  const name = form.name.trim()
  const key = form.key.trim()
  const images = Object.keys(imageModels).length > 0

  return {
    ok: true,
    config: {
      provider: id,
      name: name || undefined,
      baseURL,
      models,
      imageModels: images ? imageModels : undefined,
      imageBaseURL: images && imageBaseURL ? imageBaseURL : undefined,
    },
    key: key || undefined,
  }
}

function httpURL(text: string) {
  return URL.canParse(text) && /^https?:$/.test(new URL(text).protocol)
}

// Non-empty lines as `model-id` or `model-id = Display name`, each optionally ending in `[vision]` or `[edit]` for a
// model that accepts image input; undefined when a line has no ID before its `=`.
function modelLines(text: string): Record<string, { name?: string; images?: boolean }> | undefined {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const tagged = /\s*\[(?:vision|edit|images)\]$/i.test(line)
      const rest = line.replace(/\s*\[(?:vision|edit|images)\]$/i, "")
      const index = rest.indexOf("=")
      const id = (index === -1 ? rest : rest.slice(0, index)).trim()
      const name = index === -1 ? "" : rest.slice(index + 1).trim()

      if (!id || /\s/.test(id)) return undefined

      return [id, tagged ? (name ? { name, images: true } : { images: true }) : name ? { name } : {}] as const
    })

  if (entries.some((entry) => entry === undefined)) return undefined

  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}
