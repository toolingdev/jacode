import { describe, expect, test } from "bun:test"
import { emptyProviderForm, providerForm, readProviderForm } from "./form"

describe("custom provider form", () => {
  test("reads a provider with named and unnamed models and a key to store", () => {
    expect(
      readProviderForm(
        {
          ...emptyProviderForm,
          id: " nanogpt-sub ",
          name: " NanoGPT Subscription ",
          baseURL: " https://nano-gpt.com/api/subscription/v1 ",
          key: " secret ",
          models: "deepseek/deepseek-v4-pro = DeepSeek V4 Pro (frontier)\n\n  venice-uncensored  \nq/a=b=c",
        },
        [],
      ),
    ).toEqual({
      ok: true,
      config: {
        provider: "nanogpt-sub",
        name: "NanoGPT Subscription",
        baseURL: "https://nano-gpt.com/api/subscription/v1",
        models: {
          "deepseek/deepseek-v4-pro": { name: "DeepSeek V4 Pro (frontier)" },
          "venice-uncensored": {},
          "q/a": { name: "b=c" },
        },
      },
      key: "secret",
    })
  })

  test("reads image models with their own base URL", () => {
    expect(
      readProviderForm(
        {
          ...emptyProviderForm,
          id: "p",
          baseURL: "https://x/subscription/v1",
          models: "chat-model",
          imageModels: "z-image-turbo = Z Image Turbo\nchroma",
          imageBaseURL: " https://x/v1 ",
        },
        [],
      ),
    ).toEqual({
      ok: true,
      config: {
        provider: "p",
        baseURL: "https://x/subscription/v1",
        models: { "chat-model": {} },
        imageModels: { "z-image-turbo": { name: "Z Image Turbo" }, chroma: {} },
        imageBaseURL: "https://x/v1",
      },
      key: undefined,
    })
  })

  test("accepts a provider with only image models and drops an image base URL without them", () => {
    expect(
      readProviderForm({ ...emptyProviderForm, id: "p", baseURL: "https://x/v1", imageModels: "painter" }, []),
    ).toEqual({
      ok: true,
      config: { provider: "p", baseURL: "https://x/v1", models: {}, imageModels: { painter: {} } },
      key: undefined,
    })
    expect(
      readProviderForm(
        { ...emptyProviderForm, id: "p", baseURL: "https://x/v1", models: "m", imageBaseURL: "https://y/v1" },
        [],
      ),
    ).toEqual({ ok: true, config: { provider: "p", baseURL: "https://x/v1", models: { m: {} } }, key: undefined })
  })

  test("reports every field to fix at once", () => {
    expect(readProviderForm({ ...emptyProviderForm, id: "Has Space", baseURL: "ftp://x" }, [])).toEqual({
      ok: false,
      errors: { id: "id.invalid", baseURL: "baseURL.invalid", models: "models.required" },
    })
    expect(
      readProviderForm(
        {
          ...emptyProviderForm,
          baseURL: "https://x/v1",
          models: "= name only",
          imageModels: "two words",
          imageBaseURL: "nope",
        },
        [],
      ),
    ).toEqual({
      ok: false,
      errors: {
        id: "id.required",
        models: "models.invalid",
        imageModels: "models.invalid",
        imageBaseURL: "baseURL.invalid",
      },
    })
  })

  test("refuses an ID in use for a new provider", () => {
    expect(readProviderForm({ ...emptyProviderForm, id: "p", baseURL: "https://x/v1", models: "m" }, ["p"])).toEqual({
      ok: false,
      errors: { id: "id.taken" },
    })
  })

  test("fills the form from a saved provider without a key, and reads back the same provider", () => {
    const form = providerForm("p", {
      name: "P",
      baseURL: "https://x/v1",
      models: { "a/b": "A B", plain: "" },
      imageModels: { painter: "Painter" },
      imageBaseURL: "https://img/v1",
    })

    expect(form).toEqual({
      id: "p",
      name: "P",
      baseURL: "https://x/v1",
      key: "",
      models: "a/b = A B\nplain",
      imageModels: "painter = Painter",
      imageBaseURL: "https://img/v1",
    })
    expect(readProviderForm(form, [])).toEqual({
      ok: true,
      config: {
        provider: "p",
        name: "P",
        baseURL: "https://x/v1",
        models: { "a/b": { name: "A B" }, plain: {} },
        imageModels: { painter: { name: "Painter" } },
        imageBaseURL: "https://img/v1",
      },
      key: undefined,
    })
  })
})
