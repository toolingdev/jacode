import type { ConfigEntry } from "@opencode/client/promise"
import { showToast } from "@opencode/ui/toast"
import { createMemo, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { createExtensionLoad } from "./extension-load"

// Fork feature: settings the app saves into the server's global config, so nobody edits the config file by hand.

type Document = Extract<ConfigEntry, { type: "document" }>["info"]

/** The global config documents, lowest priority first: everything before the first project directory. */
export function globalDocuments(entries: readonly ConfigEntry[]): Document[] {
  const boundary = entries.findIndex((entry) => entry.type === "directory")

  return (boundary === -1 ? entries : entries.slice(0, boundary)).flatMap((entry) =>
    entry.type === "document" ? [entry.info] : [],
  )
}

/** The plugins or skill sources the global config lists, each once, without the entries that switch one off. */
export function listedEntries(documents: readonly Document[], key: "plugins" | "skills") {
  return [
    ...new Set(
      documents
        .flatMap((document): readonly (string | { package: string })[] => document[key] ?? [])
        .flatMap((entry) => {
          // A plugin may be listed with options, as `{ package }`; it is the same plugin either way.
          const name = entry instanceof Object ? entry.package : entry

          return name.startsWith("-") ? [] : [name]
        }),
    ),
  ]
}

/** The server's global config, read again whenever it changes, with a `save` that reports a failed write. */
export function useGlobalConfig() {
  const server = useServerSDK()
  const language = useLanguage()

  const load = createExtensionLoad({
    key: () => server.scope,
    task: (_, signal) => server.api.config.get(undefined, { signal }).then(globalDocuments),
  })

  onCleanup(server.event.on("config.updated", () => load.invalidate()))

  return {
    documents: createMemo(() => {
      const view = load.view()

      return view.status === "ready" ? view.value : undefined
    }),
    save: (write: () => Promise<object | void>) =>
      write().then(
        () => load.invalidate(),
        () => showToast({ variant: "error", title: language.t("common.requestFailed") }),
      ),
  }
}
