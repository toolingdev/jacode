import { describe, expect, test } from "bun:test"
import type { ConfigEntry, IntegrationInfo } from "@opencode/client/promise"
import { providerRows } from "./view"

const document = (providers: Extract<ConfigEntry, { type: "document" }>["info"]["providers"]): ConfigEntry => ({
  type: "document",
  info: { providers },
})

const integration = (id: string, connections: IntegrationInfo["connections"]): IntegrationInfo => ({
  id,
  name: id,
  methods: [],
  connections,
})

describe("custom provider rows", () => {
  test("lists config-defined providers by ID with their models and where the key comes from", () => {
    const rows = providerRows(
      [
        document({
          stored: { name: "Stored", settings: { baseURL: "https://a/v1", apiKey: "in-file" }, models: { m: {} } },
          env: { settings: { baseURL: "https://b/v1" } },
          file: { settings: { baseURL: "https://c/v1", apiKey: "in-file" }, models: { "x/y": { name: "X Y" } } },
          none: {},
        }),
      ],
      [
        integration("stored", [{ type: "credential", id: "cred", label: "Stored", method: "key" }]),
        integration("env", [{ type: "env", name: "ENV_KEY" }]),
        integration("file", []),
      ],
    )

    expect(rows).toMatchObject([
      { id: "env", baseURL: "https://b/v1", models: {}, imageModels: {}, key: "environment" },
      { id: "file", baseURL: "https://c/v1", models: { "x/y": { name: "X Y", images: false } }, key: "config" },
      { id: "none", models: {}, key: "missing" },
      {
        id: "stored",
        name: "Stored",
        baseURL: "https://a/v1",
        models: { m: { name: "", images: false } },
        key: "stored",
      },
    ])
    expect(rows.map((row) => [row.name, row.baseURL, row.imageBaseURL])).toEqual([
      [undefined, "https://b/v1", undefined],
      [undefined, "https://c/v1", undefined],
      [undefined, undefined, undefined],
      ["Stored", "https://a/v1", undefined],
    ])
  })

  test("takes a later document's definition of an ID and skips directories", () => {
    expect(
      providerRows(
        [
          document({ p: { name: "Old", settings: { baseURL: "https://old/v1" } } }),
          { type: "directory", path: "/config" },
          document({ p: { name: "New", settings: { baseURL: "https://new/v1" } } }),
        ],
        [],
      ),
    ).toEqual([
      {
        id: "p",
        name: "New",
        baseURL: "https://new/v1",
        models: {},
        imageModels: {},
        imageBaseURL: undefined,
        key: "missing",
      },
    ])
  })

  test("separates image models from chat models and reads where their API lives", () => {
    const images = "@opencode/ai/providers/openai-compatible/images"

    expect(
      providerRows(
        [
          document({
            p: {
              settings: { baseURL: "https://x/subscription/v1" },
              models: {
                chat: { name: "Chat", capabilities: { input: ["text", "image"] } },
                painter: {
                  name: "Painter",
                  type: "image",
                  package: images,
                  capabilities: { input: ["text"], output: ["image"] },
                  settings: { baseURL: "https://x/v1" },
                },
              },
            },
          }),
        ],
        [],
      ),
    ).toMatchObject([
      {
        id: "p",
        models: { chat: { name: "Chat", images: true } },
        imageModels: { painter: { name: "Painter", images: false } },
        imageBaseURL: "https://x/v1",
      },
    ])
  })
})
