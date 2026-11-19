import type { OpenCodeClient } from "@opencode/client/promise"
import { createLatest, usePlugin } from "@opencode/plugin/gui"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import {
  emptyProviderForm,
  providerForm,
  readProviderForm,
  type ProviderForm,
  type ProviderFormErrors,
  type ProviderFormResult,
} from "./form"
import type definition from "./index"
import { Option, Schema } from "effect"
import { CUSTOM_PROVIDER_ACTION } from "./action"
import { providerRows, type ProviderRow } from "./view"

/** How long a saved provider may take to load before its key can be stored, and how often that is checked. */
const LOAD_TIMEOUT_MS = 20_000

const LOAD_POLL_MS = 500

const decodeAction = Schema.decodeUnknownOption(
  Schema.Struct({ action: Schema.Literals(["edit", "remove"]), id: Schema.String }),
)

export default function CustomProvidersPage() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  // The routed session's server, else the app's own, else the first listed: Settings can open without a session.
  const server = createMemo(() => {
    const refs = ctx.servers.list().flatMap((id) => ctx.servers.get(id) ?? [])

    return ctx.sessions.current()?.server ?? refs.find((ref) => ref.builtin) ?? refs[0]
  })

  const location = () => ctx.sessions.current()?.location ?? server()?.data.location.default()
  const [revision, setRevision] = createSignal(0)

  // Read again after every change this page makes: a string key, so only a new revision or place loads.
  const loaded = createLatest(
    () => {
      const where = location()

      return (
        server()?.connected &&
        where &&
        JSON.stringify([server()?.id, where.directory, where.workspaceID ?? null, revision()])
      )
    },
    (_key, signal) => {
      const client = server()?.client
      const where = location()

      if (!client || !where) return Promise.resolve([])

      return Promise.all([
        client.config.get({ location: where }, { signal }),
        client.integration.list({ location: where }, { signal }),
      ]).then(([entries, integrations]) => providerRows(entries, integrations.data))
    },
  )

  const rows = () => loaded.latest ?? []
  const refresh = () => setRevision((value) => value + 1)

  const report = (cause: unknown) =>
    showToast({
      variant: "error",
      title: ctx.t("failed"),
      description: cause instanceof Error ? cause.message : String(cause),
    })

  // Runs one request for a provider's row, which stays busy until the list is read again.
  const act = <T,>(request: () => Promise<T>) => void request().then(refresh, report)

  // A saved provider loads with the config reload, a moment after the write returns; its key can be stored once
  // its integration exists. Waits for that on this side, as the server never waits for plugins.
  const storeKey = async (client: OpenCodeClient, id: string, key: string) => {
    const where = location()
    const deadline = Date.now() + LOAD_TIMEOUT_MS

    while (
      !(await client.integration.get({ integrationID: id, location: where }).then(
        () => true,
        () => false,
      ))
    ) {
      if (Date.now() > deadline) throw new Error(ctx.t("key.timeout"))
      await new Promise<void>((resolve) => setTimeout(resolve, LOAD_POLL_MS))
    }

    await client.integration.connect.key({ integrationID: id, location: where, key })
  }

  const save = async (result: Extract<ProviderFormResult, { ok: true }>) => {
    const client = server()?.client

    if (!client) return
    await client.experimental.config.provider.set(result.config)

    if (result.key) await storeKey(client, result.config.provider, result.key)
    // Without a key to wait on, give the config reload a moment before the list is read again.
    else await new Promise<void>((resolve) => setTimeout(resolve, LOAD_POLL_MS))
    refresh()
  }

  const openForm = (row?: ProviderRow) =>
    ctx.dialogs.open((dialog) => (
      <ProviderDialog
        editing={row}
        taken={row ? [] : rows().map((item) => item.id)}
        onCancel={dialog.close}
        onSubmit={(result) => save(result).then(dialog.close)}
      />
    ))

  const remove = async (row: ProviderRow) => {
    const client = server()?.client

    if (!client) return

    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("remove.title", { name: row.name ?? row.id }),
      description: ctx.t("remove.description"),
      confirm: ctx.t("remove"),
      danger: true,
    })

    if (!confirmed) return
    act(() =>
      client.experimental.config.provider
        .remove({ provider: row.id })
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, LOAD_POLL_MS))),
    )
  }

  // The Providers page lists custom providers with the connected ones and asks here to edit or remove one.
  const onAction = (event: Event) => {
    const detail = event instanceof CustomEvent ? Option.getOrUndefined(decodeAction(event.detail)) : undefined
    const row = detail && rows().find((item) => item.id === detail.id)

    if (!detail || !row) return

    if (detail.action === "edit") return void openForm(row)

    void remove(row)
  }

  window.addEventListener(CUSTOM_PROVIDER_ACTION, onAction)
  onCleanup(() => window.removeEventListener(CUSTOM_PROVIDER_ACTION, onAction))

  return (
    // Fork feature: a section of the Providers page, not a page of its own.
    <ui.SettingsSection
      title={ctx.t("title")}
      footer={
        <div class="flex items-center justify-between gap-3 pt-2">
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("description")}</p>
          <ui.Button
              variant="neutral"
              size="small"
              icon="plus"
              class="shrink-0 whitespace-nowrap"
              disabled={!server()}
              onClick={() => openForm()}
            >
            {ctx.t("add")}
          </ui.Button>
        </div>
      }
    >
      <Switch>
        <Match when={!server()}>
          <ui.SettingsRow title={ctx.t("unavailable")} />
        </Match>
        <Match when={loaded.latest === undefined}>
          <div class="flex min-h-[64px] items-center justify-center">
            <ui.Loader />
          </div>
        </Match>
      </Switch>
    </ui.SettingsSection>
  )
}

/** The add and edit form. It stays open with the fields to fix marked, and while the save runs. */
function ProviderDialog(props: {
  /** The provider being edited; its ID is fixed. Omitted to add one. */
  editing: ProviderRow | undefined
  taken: readonly string[]
  onCancel: () => void
  onSubmit: (result: Extract<ProviderFormResult, { ok: true }>) => Promise<void>
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const [form, setForm] = createSignal<ProviderForm>(
    props.editing ? providerForm(props.editing.id, props.editing) : emptyProviderForm,
  )

  const [errors, setErrors] = createSignal<ProviderFormErrors>({})
  const [saving, setSaving] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const set = (patch: Partial<ProviderForm>) => setForm((current) => ({ ...current, ...patch }))

  const submit = () => {
    if (saving()) return

    const result = readProviderForm(form(), props.taken)

    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    setFailure(undefined)
    setSaving(true)
    void props
      .onSubmit(result)
      .catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false))
  }

  // Takes the field's name, not its error, so the message follows later submits.
  const problem = (field: keyof ProviderFormErrors) => (
    <Show when={errors()[field]}>
      {(current) => <span class="text-12-regular text-v2-state-fg-danger">{ctx.t(`error.${current()}`)}</span>}
    </Show>
  )

  const heading = (text: string) => <span class="text-12-medium text-v2-text-text-muted">{text}</span>

  return (
    <ui.Dialog
      title={
        props.editing
          ? ctx.t("form.title.edit", { name: props.editing.name ?? props.editing.id })
          : ctx.t("form.title.add")
      }
      description={ctx.t("form.description")}
      footer={
        <>
          <ui.Button variant="ghost" onClick={props.onCancel}>
            {ctx.t("form.cancel")}
          </ui.Button>
          <ui.Button variant="contrast" busy={saving()} onClick={submit}>
            {ctx.t(props.editing ? "form.submit.edit" : "form.submit.add")}
          </ui.Button>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          {heading(ctx.t("form.id"))}
          <ui.TextInput
            label={ctx.t("form.id")}
            placeholder={ctx.t("form.id.placeholder")}
            size="large"
            class="w-full"
            autofocus={!props.editing}
            disabled={!!props.editing}
            value={form().id}
            invalid={!!errors().id}
            onInput={(id) => set({ id })}
            onSubmit={submit}
          />
          {problem("id")}
        </label>
        <label class="flex flex-col gap-1">
          {heading(ctx.t("form.name"))}
          <ui.TextInput
            label={ctx.t("form.name")}
            placeholder={ctx.t("form.name.placeholder")}
            size="large"
            class="w-full"
            value={form().name}
            onInput={(name) => set({ name })}
            onSubmit={submit}
          />
        </label>
        <label class="flex flex-col gap-1">
          {heading(ctx.t("form.baseURL"))}
          <ui.TextInput
            label={ctx.t("form.baseURL")}
            placeholder={ctx.t("form.baseURL.placeholder")}
            type="url"
            size="large"
            class="w-full"
            value={form().baseURL}
            invalid={!!errors().baseURL}
            onInput={(baseURL) => set({ baseURL })}
            onSubmit={submit}
          />
          {problem("baseURL")}
        </label>
        <label class="flex flex-col gap-1">
          {heading(ctx.t(props.editing ? "form.key.keep" : "form.key"))}
          <ui.TextInput
            label={ctx.t("form.key")}
            placeholder={ctx.t("form.key.placeholder")}
            type="password"
            size="large"
            class="w-full"
            value={form().key}
            onInput={(key) => set({ key })}
            onSubmit={submit}
          />
        </label>
        <div class="flex flex-col gap-1">
          <TextField
            multiline
            label={ctx.t("form.models")}
            placeholder={ctx.t("form.models.placeholder")}
            value={form().models}
            validationState={errors().models ? "invalid" : "valid"}
            onChange={(models) => set({ models })}
          />
          {problem("models")}
        </div>
        <div class="flex flex-col gap-1">
          <TextField
            multiline
            label={ctx.t("form.imageModels")}
            placeholder={ctx.t("form.imageModels.placeholder")}
            value={form().imageModels}
            validationState={errors().imageModels ? "invalid" : "valid"}
            onChange={(imageModels) => set({ imageModels })}
          />
          {problem("imageModels")}
        </div>
        <label class="flex flex-col gap-1">
          {heading(ctx.t("form.imageBaseURL"))}
          <ui.TextInput
            label={ctx.t("form.imageBaseURL")}
            placeholder={ctx.t("form.imageBaseURL.placeholder")}
            type="url"
            size="large"
            class="w-full"
            value={form().imageBaseURL}
            invalid={!!errors().imageBaseURL}
            onInput={(imageBaseURL) => set({ imageBaseURL })}
            onSubmit={submit}
          />
          {problem("imageBaseURL")}
        </label>
        <Show when={failure()}>
          {(message) => <span class="text-12-regular text-v2-state-fg-danger">{message()}</span>}
        </Show>
      </div>
    </ui.Dialog>
  )
}
