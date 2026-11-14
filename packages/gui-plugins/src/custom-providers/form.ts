import type { ExperimentalConfigProviderSetInput } from "@opencode/client/promise"

/** The custom provider form as the user typed it. */
export type ProviderForm = {
  readonly id: string
  readonly name: string
  readonly baseURL: string
  readonly key: string
  readonly models: string
}

/** What is wrong with one field, as an i18n key suffix under `error.`. */
export type ProviderFormErrors = {
  readonly id?: "id.required" | "id.invalid" | "id.taken" | undefined
  readonly baseURL?: "baseURL.invalid" | undefined
  readonly models?: "models.required" | "models.invalid" | undefined
}

export type ProviderFormResult =
  | {
      readonly ok: true
      readonly config: ExperimentalConfigProviderSetInput
      /** The API key to store, when the user typed one. */
      readonly key: string | undefined
    }
  | { readonly ok: false; readonly errors: ProviderFormErrors }

export const emptyProviderForm: ProviderForm = { id: "", name: "", baseURL: "", key: "", models: "" }

/** A saved provider as the form shows it for editing. The key is never read back. */
export function providerForm(
  id: string,
  provider: { readonly name?: string; readonly baseURL?: string; readonly models: Readonly<Record<string, string>> },
): ProviderForm {
  return {
    id,
    name: provider.name ?? "",
    baseURL: provider.baseURL ?? "",
    key: "",
    models: Object.entries(provider.models)
      .map(([model, name]) => (name ? `${model} = ${name}` : model))
      .join("\n"),
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
  const validURL = URL.canParse(baseURL) && /^https?:$/.test(new URL(baseURL).protocol)
  const models = modelLines(form.models)
  const modelsError = !models ? "models.invalid" : Object.keys(models).length === 0 ? "models.required" : undefined

  if (idError || !validURL || !models || modelsError)
    return {
      ok: false,
      errors: { id: idError, baseURL: validURL ? undefined : "baseURL.invalid", models: modelsError },
    }

  const name = form.name.trim()
  const key = form.key.trim()

  return {
    ok: true,
    config: name ? { provider: id, name, baseURL, models } : { provider: id, baseURL, models },
    key: key || undefined,
  }
}

// Non-empty lines as `model-id` or `model-id = Display name`; undefined when a line has no ID before its `=`.
function modelLines(text: string): Record<string, { name?: string }> | undefined {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const index = line.indexOf("=")
      const id = (index === -1 ? line : line.slice(0, index)).trim()
      const name = index === -1 ? "" : line.slice(index + 1).trim()

      if (!id || /\s/.test(id)) return undefined

      return [id, name ? { name } : {}] as const
    })

  if (entries.some((entry) => entry === undefined)) return undefined

  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}
