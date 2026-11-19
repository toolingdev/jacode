import { Schema } from "effect"
import { createRoot } from "solid-js"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useModels } from "./models"

// Fork feature: "Auto" is a model choice that names no model. A selection of `auto/auto` follows the model chosen
// for every provider; `<provider>/auto` follows the model chosen for that provider. The choice is stored as it is
// picked and resolved each time it is read, so changing what Auto means moves every session that uses it.
export const AUTO = "auto"

type ModelRef = { providerID: string; modelID: string }

export const AutoModelsSchema = Schema.Struct({
  /** What Auto across every provider uses. */
  all: Persistence.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  /** Deprecated: the server picks the image model now. */
  image: Persistence.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  /** What Auto within a provider uses, as that provider's model ID. */
  providers: Persistence.record(Persistence.fallback(Schema.String, () => "")),
  /** Fork feature: providers Auto across every provider leaves out, such as one billed per use. */
  excluded: Persistence.optional(Schema.Record(Schema.String, Schema.Boolean)),
})

export type AutoModels = typeof AutoModelsSchema.Type

export function isAutoModel(model: ModelRef) {
  return model.modelID === AUTO
}

/**
 * The model an Auto choice uses now. Without a usable choice of its own, Auto falls back to the default model, and
 * within a provider that default does not belong to, to that provider's first model.
 */
export function resolveAutoModel(
  model: ModelRef,
  chosen: AutoModels,
  input: {
    valid: (model: ModelRef) => boolean
    fallback: () => ModelRef | undefined
    first: (providerID: string) => ModelRef | undefined
  },
) {
  if (model.providerID === AUTO) return chosen.all && input.valid(chosen.all) ? chosen.all : input.fallback()

  const own = { providerID: model.providerID, modelID: chosen.providers[model.providerID] ?? "" }

  if (input.valid(own)) return own
  const fallback = input.fallback()

  return fallback?.providerID === model.providerID ? fallback : input.first(model.providerID)
}

type ImageReader = { capabilities: { input: { image: boolean } } }

/**
 * Auto as a catalog model: it reports reading images, because the server sends a prompt with images to a model in
 * Auto's scope that reads them. So an image attaches as one instead of as a file path.
 */
export function autoAcceptsImages<Model extends ImageReader>(usual: Model) {
  if (usual.capabilities.input.image) return usual

  return { ...usual, capabilities: { ...usual.capabilities, input: { ...usual.capabilities.input, image: true } } }
}

/**
 * Auto for one model selection: which Auto choices it accepts, and the catalog model each one uses now, named so
 * every surface shows that Auto chose it.
 */
export function createAutoSelection(input: {
  valid: (model: ModelRef) => boolean
  connected: (providerID: string) => boolean
  fallback: () => ModelRef | undefined
}) {
  const models = useModels()
  const auto = useAutoModels()
  const language = useLanguage()

  // The catalog model Auto stands on until the server picks one per prompt. It is never shown by name: the server
  // may answer with any model in Auto's scope, so every surface says Auto.
  const resolve = (item: ModelRef) => {
    const target = resolveAutoModel(item, auto.chosen, {
      valid: input.valid,
      fallback: input.fallback,
      first: (providerID) =>
        models
          .list()
          .filter((model) => model.provider.id === providerID)
          .map((model) => ({ providerID, modelID: model.id }))
          .find(input.valid),
    })

    const found = target && models.find(target)

    return found && { ...autoAcceptsImages(found), name: language.t("dialog.model.auto") }
  }

  return {
    resolve,
    valid: (model: ModelRef) =>
      isAutoModel(model) ? model.providerID === AUTO || input.connected(model.providerID) : input.valid(model),
    find: (item: ModelRef) => (isAutoModel(item) ? resolve(item) : models.find(item)),
  }
}

// One store for the window: the picker, the composer and settings must agree the moment a choice changes.
let shared: ReturnType<typeof open> | undefined

function open(platform: ReturnType<typeof usePlatform>) {
  return createRoot(() => persisted(Persist.global("auto-models"), AutoModelsSchema, { providers: {} }, platform))
}

export function useAutoModels() {
  const platform = usePlatform()

  shared ??= open(platform)
  const [chosen, setChosen] = shared

  return {
    chosen,
    setExcluded: (providerID: string, excluded: boolean) =>
      setChosen({ excluded: { ...chosen.excluded, [providerID]: excluded } }),
  }
}
