import { describe, expect, test } from "bun:test"
import { emptyProviderForm, providerForm, readProviderForm } from "./form"

describe("custom provider form", () => {
  test("reads a provider with named and unnamed models and a key to store", () => {
    expect(
      readProviderForm(
        {
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

  test("leaves out an empty name and stores no key when none is typed", () => {
    expect(
      readProviderForm({ ...emptyProviderForm, id: "p", baseURL: "http://localhost:11434/v1", models: "m" }, []),
    ).toEqual({
      ok: true,
      config: { provider: "p", baseURL: "http://localhost:11434/v1", models: { m: {} } },
      key: undefined,
    })
  })

  test("reports every field to fix at once", () => {
    expect(readProviderForm({ ...emptyProviderForm, id: "Has Space", baseURL: "ftp://x", models: "" }, [])).toEqual({
      ok: false,
      errors: { id: "id.invalid", baseURL: "baseURL.invalid", models: "models.required" },
    })
    expect(readProviderForm({ ...emptyProviderForm, baseURL: "https://x/v1", models: "= name only" }, [])).toEqual({
      ok: false,
      errors: { id: "id.required", models: "models.invalid" },
    })
    expect(
      readProviderForm({ ...emptyProviderForm, id: "p", baseURL: "https://x/v1", models: "two words" }, []),
    ).toEqual({
      ok: false,
      errors: { models: "models.invalid" },
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
    })

    expect(form).toEqual({ id: "p", name: "P", baseURL: "https://x/v1", key: "", models: "a/b = A B\nplain" })
    expect(readProviderForm(form, [])).toEqual({
      ok: true,
      config: { provider: "p", name: "P", baseURL: "https://x/v1", models: { "a/b": { name: "A B" }, plain: {} } },
      key: undefined,
    })
  })
})
