import { expect, test } from "bun:test"
import { ConfigSecrets } from "../../src/config/secrets"

test("a secret written out in full is hidden, a reference to one is shown", () => {
  expect(
    ConfigSecrets.hide({
      name: "Acme",
      settings: { apiKey: "sk-live-123", baseURL: "https://acme.test" },
      headers: { Authorization: "{env:ACME_TOKEN}" },
    }),
  ).toEqual({
    name: "Acme",
    settings: { apiKey: ConfigSecrets.HIDDEN, baseURL: "https://acme.test" },
    headers: { Authorization: "{env:ACME_TOKEN}" },
  })
})

test("saving keeps the file's secret where the edit still shows it hidden", () => {
  const previous = { settings: { apiKey: "sk-live-123", baseURL: "https://old.test" } }
  const edited = { settings: { apiKey: ConfigSecrets.HIDDEN, baseURL: "https://new.test" } }

  expect(ConfigSecrets.restore(edited, previous)).toEqual({
    settings: { apiKey: "sk-live-123", baseURL: "https://new.test" },
  })
  expect(ConfigSecrets.restore({ settings: { apiKey: ConfigSecrets.HIDDEN } }, undefined)).toEqual({ settings: {} })
  expect(ConfigSecrets.restore({ settings: { apiKey: "{env:NEW}" } }, previous)).toEqual({
    settings: { apiKey: "{env:NEW}" },
  })
})
