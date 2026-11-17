import type { McpServer } from "@opencode/client/promise"
import { createKeyed, createLatest, usePlugin } from "@opencode/plugin/gui"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { emptyMcpForm, mcpFormOf, readMcpForm, type McpConfig, type McpForm, type McpFormErrors } from "./form"
import type definition from "./index"

export default function McpServersPage() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  // The routed session's server, else the app's own, else the first listed: Settings can open without a session.
  const server = createMemo(() => {
    const refs = ctx.servers.list().flatMap((id) => ctx.servers.get(id) ?? [])

    return ctx.sessions.current()?.server ?? refs.find((ref) => ref.builtin) ?? refs[0]
  })

  // MCP connections are per location: the routed session's, else the server's default.
  const location = () => ctx.sessions.current()?.location ?? server()?.data.location.default()

  const refresh = () => {
    const current = server()
    const where = location()

    if (!current || !where) return Promise.resolve()
    current.data.location.mcp.server.invalidate(where)

    return current.data.location.mcp.server.sync(where).catch(() => undefined)
  }

  // Loads the list from the server; afterwards the synced data follows the server's MCP status events.
  createKeyed(
    () => {
      const where = location()

      return server()?.connected && where && JSON.stringify([server()?.id, where.directory, where.workspaceID ?? null])
    },
    () => void refresh(),
  )

  const servers = createMemo(() => {
    const where = location()

    return [...((where && server()?.data.location.mcp.server.list(where)) || [])].toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )
  })

  const [busy, setBusy] = createSignal<readonly string[]>([])

  // Runs one request for a server's row, which stays busy until the list reflects it.
  const act = <T,>(name: string, request: () => Promise<T>) => {
    setBusy((names) => [...names, name])
    void request()
      .then(refresh, (cause) =>
        showToast({
          variant: "error",
          title: ctx.t("failed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => setBusy((names) => names.filter((item) => item !== name)))
  }

  const toggle = (item: McpServer, enabled: boolean) => {
    const client = server()?.client
    const where = location()

    if (!client || !where) return
    act(item.name, () =>
      enabled
        ? client.experimental.mcp.connect({ server: item.name, location: where })
        : client.experimental.mcp.disconnect({ server: item.name, location: where }),
    )
  }

  const reconnect = (item: McpServer) => {
    const client = server()?.client
    const where = location()

    if (!client || !where) return
    act(item.name, () =>
      client.experimental.mcp
        .disconnect({ server: item.name, location: where })
        .then(() => client.experimental.mcp.connect({ server: item.name, location: where })),
    )
  }

  // Fork feature: a server runs once per folder, so one that failed to start, say because an approval prompt was
  // missed, is down in each folder on its own. This restarts it in every folder this app knows a session in, one
  // after the other so that prompts come one at a time.
  const reconnectEverywhere = (item: McpServer) => {
    const current = server()
    const where = location()

    if (!current || !where) return

    const places = [
      ...new Map(
        [
          where,
          current.data.location.default(),
          ...current.data.session.list().map((session) => session.location),
        ].flatMap((place) => (place.directory === "" ? [] : [[place.directory, place] as const])),
      ).values(),
    ]

    act(item.name, () =>
      places.reduce(
        (done, place) =>
          done.then(() =>
            current.client.experimental.mcp
              .disconnect({ server: item.name, location: place })
              .then(() => current.client.experimental.mcp.connect({ server: item.name, location: place }))
              // One folder that will not start must not keep the rest from trying.
              .then(
                () => undefined,
                () => undefined,
              ),
          ),
        Promise.resolve(),
      ),
    )
  }

  const remove = async (item: McpServer) => {
    const client = server()?.client

    if (!client) return

    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("remove.title", { name: item.name }),
      description: ctx.t("remove.description"),
      confirm: ctx.t("remove"),
      danger: true,
    })

    if (!confirmed) return
    // The config reload that follows the write stops the server; the list then follows its status events.
    act(item.name, () => client.experimental.config.mcp.remove({ server: item.name }).then(settle))
  }

  // Config reloads after the write returns, so the list is read again once the reload has had time to apply.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 500))

  const showTools = (item: McpServer) =>
    ctx.dialogs.open(() => <ToolsDialog name={item.name} server={server} location={location} />)

  // Opens the form, empty to add a server or filled with a saved one to change it, and saves what it returns.
  const openForm = (editing?: { name: string; config: McpConfig }) =>
    ctx.dialogs.open((dialog) => (
      <AddDialog
        editing={editing}
        taken={servers().flatMap((item) => (item.name === editing?.name ? [] : [item.name]))}
        onCancel={dialog.close}
        onSubmit={(name, config) => {
          const client = server()?.client

          if (!client) return Promise.resolve()

          return client.experimental.config.mcp
            .set({ server: name, config })
            .then(settle)
            .then(refresh)
            .then(dialog.close)
        }}
      />
    ))

  // Fork feature: change a saved server in place. Its settings come from the global config, the file the form writes.
  const edit = (item: McpServer) => {
    const client = server()?.client

    if (!client) return
    void client.config.get().then(
      (entries) => {
        const boundary = entries.findIndex((entry) => entry.type === "directory")

        const config = (boundary === -1 ? entries : entries.slice(0, boundary))
          .flatMap((entry) => (entry.type === "document" ? [entry.info.mcp?.servers?.[item.name]] : []))
          .findLast((found) => found !== undefined)

        if (!config) return showToast({ title: ctx.t("edit.elsewhere", { name: item.name }) })
        void openForm({ name: item.name, config })
      },
      (cause) =>
        showToast({
          variant: "error",
          title: ctx.t("failed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
    )
  }

  const status = (item: McpServer) =>
    item.status.status === "failed"
      ? ctx.t("status.failed", { error: item.status.error })
      : ctx.t(`status.${item.status.status}`)

  return (
    <ui.SettingsLayout
      title={ctx.t("title")}
      description={ctx.t("description")}
      actions={
        <ui.Button variant="neutral" size="small" icon="plus" disabled={!server()} onClick={() => void openForm()}>
          {ctx.t("add")}
        </ui.Button>
      }
    >
      <ui.SettingsSection>
        <Switch>
          <Match when={!server()}>
            <ui.SettingsRow title={ctx.t("unavailable")} />
          </Match>
          <Match when={servers().length === 0}>
            <ui.SettingsRow title={ctx.t("empty")} description={ctx.t("empty.description")} />
          </Match>
          <Match when={true}>
            <For each={servers()}>
              {(item) => (
                <ui.SettingsRow
                  title={item.title ? `${item.name} · ${item.title}` : item.name}
                  description={status(item)}
                >
                  <div class="flex items-center gap-2">
                    <Show when={busy().includes(item.name) || item.status.status === "pending"}>
                      <ui.Loader />
                    </Show>
                    <ui.Switch
                      label={ctx.t("enabled", { name: item.name })}
                      hideLabel
                      checked={item.status.status !== "disabled"}
                      disabled={busy().includes(item.name) || item.status.status === "pending"}
                      onChange={(enabled) => toggle(item, enabled)}
                    />
                    <ui.Menu
                      label={ctx.t("actions", { name: item.name })}
                      disabled={busy().includes(item.name)}
                      items={[
                        { label: ctx.t("edit"), icon: "edit", onSelect: () => edit(item) },
                        { label: ctx.t("reconnect"), icon: "reset", onSelect: () => reconnect(item) },
                        { label: ctx.t("reconnect.all"), icon: "reset", onSelect: () => reconnectEverywhere(item) },
                        { label: ctx.t("tools"), icon: "mcp", onSelect: () => void showTools(item) },
                        { type: "separator" },
                        { label: ctx.t("remove"), icon: "trash", onSelect: () => void remove(item) },
                      ]}
                    />
                  </div>
                </ui.SettingsRow>
              )}
            </For>
          </Match>
        </Switch>
      </ui.SettingsSection>
    </ui.SettingsLayout>
  )
}

type PageServer = ReturnType<ReturnType<typeof usePlugin>["servers"]["get"]>

type PageLocation = NonNullable<PageServer>["data"]["location"] extends { default(): infer L } ? L : never

/** The tools one MCP server offers at the location, loaded when the dialog opens. */
function ToolsDialog(props: { name: string; server: () => PageServer; location: () => PageLocation | undefined }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const tools = createLatest(
    () => props.server()?.connected && props.location() && props.name,
    (name, signal) => {
      const client = props.server()?.client

      if (!client) return Promise.resolve([])

      return client.experimental.mcp
        .tools({ server: name, location: props.location() }, { signal })
        .then((output) => output.data)
    },
  )

  return (
    <ui.Dialog
      title={ctx.t("tools.title", { name: props.name })}
      description={tools.latest ? ctx.t("tools.count", { count: tools.latest.length }) : undefined}
      size="large"
    >
      <Switch>
        <Match when={tools.error !== undefined}>
          <p class="text-13-regular text-v2-text-text-muted">{ctx.t("tools.failed")}</p>
        </Match>
        <Match when={tools.latest === undefined}>
          <div class="flex min-h-[120px] items-center justify-center">
            <ui.Loader />
          </div>
        </Match>
        <Match when={tools.latest?.length === 0}>
          <p class="text-13-regular text-v2-text-text-muted">{ctx.t("tools.empty")}</p>
        </Match>
        <Match when={true}>
          <ul class="flex flex-col gap-3">
            <For each={tools.latest}>
              {(tool) => (
                <li class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-13-medium text-v2-text-text-base">{tool.name}</span>
                  <Show when={tool.description}>
                    <span class="line-clamp-2 text-13-regular text-v2-text-text-muted">{tool.description}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </ui.Dialog>
  )
}

type SubmitConfig = Extract<ReturnType<typeof readMcpForm>, { ok: true }>["config"]

/** The server form, to add one or to change a saved one. It stays open with the fields to fix marked, and while the save runs. */
function AddDialog(props: {
  /** The saved server being changed. Its name is fixed, since the name is what the config stores it under. */
  editing?: { name: string; config: McpConfig }
  taken: readonly string[]
  onCancel: () => void
  onSubmit: (name: string, config: SubmitConfig) => Promise<void>
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const [form, setForm] = createSignal<McpForm>(
    props.editing ? mcpFormOf(props.editing.name, props.editing.config) : emptyMcpForm,
  )

  const [errors, setErrors] = createSignal<McpFormErrors>({})
  const [saving, setSaving] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const set = (patch: Partial<McpForm>) => setForm((current) => ({ ...current, ...patch }))

  const submit = () => {
    if (saving()) return
    const result = readMcpForm(form(), props.taken, props.editing?.config)

    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    setFailure(undefined)
    setSaving(true)
    void props
      .onSubmit(result.name, result.config)
      .catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false))
  }

  // Takes the field's name, not its error, so the message follows later submits.
  const problem = (field: keyof McpFormErrors) => (
    <Show when={errors()[field]}>
      {(current) => <span class="text-12-regular text-v2-state-fg-danger">{ctx.t(`error.${current()}`)}</span>}
    </Show>
  )

  return (
    <ui.Dialog
      title={props.editing ? ctx.t("form.title.edit", { name: props.editing.name }) : ctx.t("form.title")}
      description={ctx.t("form.description")}
      footer={
        <>
          <ui.Button variant="ghost" onClick={props.onCancel}>
            {ctx.t("form.cancel")}
          </ui.Button>
          <ui.Button variant="contrast" busy={saving()} onClick={submit}>
            {props.editing ? ctx.t("form.save") : ctx.t("form.submit")}
          </ui.Button>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.name")}</span>
          <ui.TextInput
            label={ctx.t("form.name")}
            placeholder={ctx.t("form.name.placeholder")}
            size="large"
            class="w-full"
            autofocus={!props.editing}
            disabled={!!props.editing}
            value={form().name}
            invalid={!!errors().name}
            onInput={(name) => set({ name })}
            onSubmit={submit}
          />
          {problem("name")}
        </label>
        <div class="flex gap-2">
          <ui.Button
            size="small"
            variant={form().type === "local" ? "neutral" : "ghost"}
            onClick={() => set({ type: "local" })}
          >
            {ctx.t("form.type.local")}
          </ui.Button>
          <ui.Button
            size="small"
            variant={form().type === "remote" ? "neutral" : "ghost"}
            onClick={() => set({ type: "remote" })}
          >
            {ctx.t("form.type.remote")}
          </ui.Button>
        </div>
        <Show
          when={form().type === "local"}
          fallback={
            <>
              <label class="flex flex-col gap-1">
                <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.url")}</span>
                <ui.TextInput
                  label={ctx.t("form.url")}
                  placeholder={ctx.t("form.url.placeholder")}
                  type="url"
                  size="large"
                  class="w-full"
                  value={form().url}
                  invalid={!!errors().url}
                  onInput={(url) => set({ url })}
                  onSubmit={submit}
                />
                {problem("url")}
              </label>
              <div class="flex flex-col gap-1">
                <TextField
                  multiline
                  label={ctx.t("form.headers")}
                  placeholder={ctx.t("form.headers.placeholder")}
                  value={form().headers}
                  validationState={errors().headers ? "invalid" : "valid"}
                  onChange={(headers) => set({ headers })}
                />
                {problem("headers")}
              </div>
            </>
          }
        >
          <label class="flex flex-col gap-1">
            <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.command")}</span>
            <ui.TextInput
              label={ctx.t("form.command")}
              placeholder={ctx.t("form.command.placeholder")}
              size="large"
              class="w-full"
              value={form().command}
              invalid={!!errors().command}
              onInput={(command) => set({ command })}
              onSubmit={submit}
            />
            {problem("command")}
          </label>
          <div class="flex flex-col gap-1">
            <TextField
              multiline
              label={ctx.t("form.environment")}
              placeholder={ctx.t("form.environment.placeholder")}
              value={form().environment}
              validationState={errors().environment ? "invalid" : "valid"}
              onChange={(environment) => set({ environment })}
            />
            {problem("environment")}
          </div>
        </Show>
        <label class="flex flex-col gap-1">
          <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.startup")}</span>
          <ui.TextInput
            label={ctx.t("form.startup")}
            placeholder={ctx.t("form.startup.placeholder")}
            size="large"
            class="w-full"
            value={form().startup}
            invalid={!!errors().startup}
            onInput={(startup) => set({ startup })}
            onSubmit={submit}
          />
          {problem("startup")}
        </label>
        <Show when={failure()}>
          {(message) => <span class="text-12-regular text-v2-state-fg-danger">{message()}</span>}
        </Show>
      </div>
    </ui.Dialog>
  )
}
