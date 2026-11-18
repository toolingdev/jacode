import { describe, expect, test } from "bun:test"
import type { ConfigEntry, CredentialEntry } from "@opencode/client/promise"
import { copyPlan } from "./providers"

const document = (providers: Extract<ConfigEntry, { type: "document" }>["info"]["providers"]): ConfigEntry => ({
  type: "document",
  info: { providers },
})

const credential = (integrationID: string, value: CredentialEntry["value"], active = true): CredentialEntry => ({
  id: `cred_${integrationID}`,
  integrationID,
  label: "",
  active,
  value,
})

describe("copying providers to a worker", () => {
  test("saves an added provider before its key, and keeps image models apart", () => {
    const plan = copyPlan(
      [
        document({
          mine: {
            name: "Mine",
            settings: { baseURL: "https://example.test/v1", apiKey: "sk-literal" },
            models: {
              chat: { name: "Chat", capabilities: { input: ["text", "image"] } },
              draw: { type: "image", settings: { baseURL: "https://example.test/img" } },
            },
          },
        }),
      ],
      [],
    )

    expect(plan).toEqual([
      {
        type: "provider",
        id: "mine",
        config: {
          name: "Mine",
          baseURL: "https://example.test/v1",
          models: { chat: { name: "Chat", images: true } },
          imageModels: { draw: { images: false } },
          imageBaseURL: "https://example.test/img",
        },
      },
      { type: "key", id: "mine", key: "sk-literal" },
    ])
  })

  test("leaves a key this computer reads from its environment for main to resolve", () => {
    expect(copyPlan([document({ "nano-gpt": { settings: { apiKey: "{env:NANOGPT_API_KEY}" } } })], [])).toEqual([
      { type: "env", id: "nano-gpt", variable: "NANOGPT_API_KEY" },
    ])
  })

  test("takes a stored key over the config's, and cannot copy a sign-in", () => {
    const plan = copyPlan(
      [document({ a: { settings: { apiKey: "from-config" } } })],
      [
        credential("a", { type: "key", key: "from-store" }),
        credential("b", { type: "external", methodID: "browser" }),
        credential("c", { type: "key", key: "unused" }, false),
      ],
    )

    expect(plan).toEqual([
      { type: "key", id: "a", key: "from-store" },
      { type: "skip", id: "b" },
    ])
  })

  test("reads only the global config, not a project's own", () => {
    const plan = copyPlan(
      [
        document({ global: { settings: { apiKey: "g" } } }),
        { type: "directory", path: "/work/project" },
        document({ project: { settings: { apiKey: "p" } } }),
      ],
      [],
    )

    expect(plan.map((step) => step.id)).toEqual(["global"])
  })
})
