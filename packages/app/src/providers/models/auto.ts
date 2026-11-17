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
  /** What Auto uses for a prompt with images, when the model it would use cannot read them. */
  image: Persistence.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  /** What Auto within a provider uses, as that provider's model ID. */
  providers: Persistence.record(Persistence.fallback(Schema.String, () => "")),
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
 * The model Auto sends a prompt with: the image model when the prompt has images its usual model cannot read.
 * Before any image is attached, the usual model is reported as reading images, so an image attaches as one instead
 * of as a file path and the prompt can then move to the image model.
 */
export function autoImageModel<Model extends ImageReader>(usual: Model, image: Model | undefined, attached: boolean) {
  if (!image?.capabilities.input.image || usual.capabilities.input.image) return usual

  if (attached) return image

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

  const resolve = (item: ModelRef, prompt?: { image: boolean }) => {
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

    const usual = target && models.find(target)

    const found =
      usual &&
      autoImageModel(
        usual,
        auto.chosen.image && input.valid(auto.chosen.image) ? models.find(auto.chosen.image) : undefined,
        !!prompt?.image,
      )

    return found && { ...found, name: language.t("dialog.model.auto.named", { name: found.name }) }
  }

  return {
    resolve,
    valid: (model: ModelRef) =>
      isAutoModel(model) ? model.providerID === AUTO || input.connected(model.providerID) : input.valid(model),
    find: (item: ModelRef, prompt?: { image: boolean }) =>
      isAutoModel(item) ? resolve(item, prompt) : models.find(item),
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
    setAll: (model: ModelRef | undefined) => setChosen({ all: model }),
    setImage: (model: ModelRef | undefined) => setChosen({ image: model }),
    setProvider: (providerID: string, modelID: string | undefined) => setChosen("providers", providerID, modelID ?? ""),
  }
}
