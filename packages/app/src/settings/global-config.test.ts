import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client/promise"
import { globalDocuments, listedEntries } from "./global-config"

const document = (info: Extract<ConfigEntry, { type: "document" }>["info"]): ConfigEntry => ({ type: "document", info })

// SAFETY: only `type` is read from a directory entry here; its path is a branded string a literal cannot be.
const directory = { type: "directory", path: "/work/.opencode" } as ConfigEntry

test("global config ends where the first project directory begins", () => {
  const entries = [document({ shell: "zsh" }), directory, document({ shell: "fish" })]

  expect(globalDocuments(entries)).toEqual([{ shell: "zsh" }])
})

test("listed plugins are named once, with or without options, and without switched-off entries", () => {
  const documents = globalDocuments([
    document({ plugins: ["opencode-foo", { package: "opencode-bar", options: {} }] }),
    document({ plugins: ["opencode-foo", "-opencode.builtin"] }),
  ])

  expect(listedEntries(documents, "plugins")).toEqual(["opencode-foo", "opencode-bar"])
  expect(listedEntries(documents, "skills")).toEqual([])
})
