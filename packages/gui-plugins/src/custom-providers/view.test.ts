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

    expect(rows).toEqual([
      { id: "env", name: undefined, baseURL: "https://b/v1", models: {}, key: "environment" },
      { id: "file", name: undefined, baseURL: "https://c/v1", models: { "x/y": "X Y" }, key: "config" },
      { id: "none", name: undefined, baseURL: undefined, models: {}, key: "missing" },
      { id: "stored", name: "Stored", baseURL: "https://a/v1", models: { m: "" }, key: "stored" },
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
    ).toEqual([{ id: "p", name: "New", baseURL: "https://new/v1", models: {}, key: "missing" }])
  })
})
