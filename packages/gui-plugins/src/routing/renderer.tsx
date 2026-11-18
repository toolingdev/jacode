import type { ConfigExperimentalDecisions } from "@opencode/client/promise"
import { ComposerPill, createKeyed, type ComposerPillProps, type Plugin, type ServerRef } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { createStore } from "solid-js/store"
import { lastDecision, shortModel } from "./decision"
import type definition from "./index"

/**
 * Fork feature: smart routing made visible. A decision model looks at every prompt and picks the model that answers
 * it; this pill above the composer says what it picked for the chat's latest prompt and how surely, and turns
 * routing off or on. Routing is one setting of the server, so the switch is for every chat on it.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // Each server's routing settings: `undefined` until read, `null` when the server has none.
  const [settings, setSettings] = createStore<Record<string, ConfigExperimentalDecisions | null>>({})

  const read = (server: ServerRef) =>
    server.client.config.get().then(
      (entries) => {
        const boundary = entries.findIndex((entry) => entry.type === "directory")

        setSettings(
          server.id,
          (boundary === -1 ? entries : entries.slice(0, boundary))
            .flatMap((entry) => (entry.type === "document" ? [entry.info.experimental?.decisions] : []))
            .findLast((found) => found !== undefined) ?? null,
        )
      },
      () => undefined,
    )

  // Read once per server; the settings page and this pill's own switch are the only things that change them.
  createKeyed(
    () => ctx.sessions.current()?.server.id,
    () => {
      const server = ctx.sessions.current()?.server

      if (server) void read(server)
    },
  )

  // A routed model by the name the model picker shows, falling back to its short ID while the list loads.
  const modelName = (input: ComposerPillProps, key: string) => {
    const providerID = key.slice(0, key.indexOf("/"))
    const id = key.slice(key.indexOf("/") + 1)

    return (
      input.session.server.data.location.model
        .list(input.session.directory ? { directory: input.session.directory } : undefined)
        ?.findLast((item) => item.providerID === providerID && item.id === id)?.name ?? shortModel(key)
    )
  }

  const decision = (input: ComposerPillProps) => lastDecision(input.session.server.data.session.message.list(input.session.id))

  const toggle = (server: ServerRef, current: ConfigExperimentalDecisions) => {
    const next = { ...current, enabled: current.enabled === false }

    setSettings(server.id, next)
    void server.client.experimental.config.decisions.set(next).then(
      () => undefined,
      () => {
        setSettings(server.id, current)
        showToast({ variant: "error", title: ctx.t("failed") })
      },
    )
  }

  ctx.add(ComposerPill, {
    id: "routing",
    order: 20,
    show: (input) => {
      const server = input.session.server
      const current = settings[server.id]

      // A server with no routing set up shows nothing; Settings is where it is set up.
      if (!current) return

      const answers = decision(input)
      const model = answers?.find((answer) => answer.name === "model")
      const size = answers?.find((answer) => answer.name === "size")
      const sure = (confidence: number) => ctx.t("sure", { percent: Math.round(confidence * 100) })
      const on = current.enabled !== false

      return {
        icon: "branch",
        tone: on ? undefined : "warning",
        title: ctx.t("title"),
        label: !on ? ctx.t("off") : model ? ctx.t("routed", { model: modelName(input, model.choice) }) : ctx.t("on"),
        rows: [
          ...(on && model
            ? [{ id: "model", label: ctx.t("row.model", { model: modelName(input, model.choice) }), detail: sure(model.confidence) }]
            : []),
          ...(on && size
            ? [
                {
                  id: "size",
                  label: ctx.t(size.choice === "large" ? "row.size.large" : "row.size.small"),
                  detail: sure(size.confidence),
                },
              ]
            : []),
          ...(on && !model && !size ? [{ id: "none", label: ctx.t("row.none") }] : []),
          // A remote server may run a build that does not know the switch yet, so only this computer's offers it.
          ...(server.builtin
            ? [
                {
                  id: "toggle",
                  label: ctx.t(on ? "turn.off" : "turn.on"),
                  icon: on ? ("stop" as const) : ("refresh" as const),
                  run: () => toggle(server, current),
                },
              ]
            : []),
          { id: "settings", label: ctx.t("settings"), icon: "settings-gear" as const, run: () => ctx.layout.settings("models") },
        ],
      }
    },
  })
}

export default setup
