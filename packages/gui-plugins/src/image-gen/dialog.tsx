import { createLatest, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { TextField } from "@opencode/ui/text-field"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { aspects, counts, imageBytes, imagePath, modelRef, modelValue, type Aspect, type Count } from "./image"
import type definition from "./index"

/** One generated image as the dialog shows it: the picture, and where it was saved or why it was not. */
type Result = {
  readonly src: string
  readonly saved: { readonly path: string } | { readonly error: string }
}

export default function ImageDialog(props: { session: MountedSession; onClose: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  // Loaded once per dialog: the image models of the session's location, whatever provider offers them.
  const models = createLatest(
    () => props.session.server.connected && props.session.location && props.session.key,
    (_key, signal) =>
      props.session.server.client.model
        .list({ location: props.session.location, types: ["image"] }, { signal })
        .then((output) => output.data.filter((model) => model.type === "image")),
  )

  const options = createMemo(() =>
    (models.latest ?? []).map((model) => ({ value: modelValue(model), label: model.name || model.id })),
  )

  const [prompt, setPrompt] = createSignal("")
  const [picked, setPicked] = createSignal<string>()
  const [aspect, setAspect] = createSignal<Aspect>("1:1")
  const [count, setCount] = createSignal<Count>("1")
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [results, setResults] = createSignal<readonly Result[]>([])
  // The first model until the user picks one, so a single model needs no choice.
  const model = () => picked() ?? options()[0]?.value

  const generate = () => {
    const value = model()
    const location = props.session.location
    const text = prompt().trim()

    if (busy() || !value || !location) return

    if (!text) return setFailure(ctx.t("error.prompt"))

    const client = props.session.server.client
    const at = new Date()

    setFailure(undefined)
    setBusy(true)
    void client.experimental.generate
      .image({ model: modelRef(value), prompt: text, aspect: aspect(), n: Number(count()) })
      .then((output) =>
        Promise.all(
          output.images.map((image, index) =>
            client.experimental.file
              .write({ location, path: imagePath(at, index, image.mime), payload: imageBytes(image.data) })
              .then(
                (written): Result["saved"] => ({ path: written.data.path }),
                (cause): Result["saved"] => ({ error: cause instanceof Error ? cause.message : String(cause) }),
              )
              .then((saved): Result => ({ src: `data:${image.mime};base64,${image.data}`, saved })),
          ),
        ),
      )
      .then(
        (generated) => setResults((current) => [...generated, ...current]),
        (cause) => setFailure(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false))
  }

  const heading = (text: string) => <span class="text-12-medium text-v2-text-text-muted">{text}</span>

  return (
    <ui.Dialog
      title={ctx.t("title")}
      description={ctx.t("description")}
      size="large"
      footer={
        <>
          <ui.Button variant="ghost" onClick={props.onClose}>
            {ctx.t("close")}
          </ui.Button>
          <ui.Button variant="contrast" busy={busy()} disabled={!model()} onClick={generate}>
            {ctx.t(busy() ? "generating" : "generate")}
          </ui.Button>
        </>
      }
    >
      <Switch>
        <Match when={models.error !== undefined}>
          <p class="text-13-regular text-v2-text-text-muted">{ctx.t("models.failed")}</p>
        </Match>
        <Match when={models.latest === undefined}>
          <div class="flex min-h-[120px] items-center justify-center gap-2 text-13-regular text-v2-text-text-muted">
            <ui.Loader />
            {ctx.t("models.loading")}
          </div>
        </Match>
        <Match when={options().length === 0}>
          <div class="flex flex-col items-start gap-2">
            <p class="text-13-medium text-v2-text-text-base">{ctx.t("models.empty")}</p>
            <p class="text-13-regular text-v2-text-text-muted">{ctx.t("models.empty.description")}</p>
            <ui.Button
              variant="neutral"
              size="small"
              onClick={() => {
                props.onClose()
                ctx.layout.settings("custom-providers")
              }}
            >
              {ctx.t("models.open")}
            </ui.Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="flex flex-col gap-3">
            <TextField
              multiline
              label={ctx.t("prompt")}
              placeholder={ctx.t("prompt.placeholder")}
              value={prompt()}
              onChange={setPrompt}
            />
            <div class="flex flex-wrap items-end gap-3">
              <label class="flex min-w-[180px] flex-1 flex-col gap-1">
                {heading(ctx.t("model"))}
                <ui.Select label={ctx.t("model")} options={options()} value={model()} onChange={setPicked} />
              </label>
              <label class="flex flex-col gap-1">
                {heading(ctx.t("aspect"))}
                <ui.Select
                  label={ctx.t("aspect")}
                  options={aspects.map((value) => ({ value, label: value }))}
                  value={aspect()}
                  onChange={setAspect}
                />
              </label>
              <label class="flex flex-col gap-1">
                {heading(ctx.t("count"))}
                <ui.Select
                  label={ctx.t("count")}
                  options={counts.map((value) => ({ value, label: value }))}
                  value={count()}
                  onChange={setCount}
                />
              </label>
            </div>
            <Show when={failure()}>
              {(message) => <span class="text-12-regular text-v2-state-fg-danger">{message()}</span>}
            </Show>
            <Show when={results().length > 0}>
              <ul class="grid grid-cols-2 gap-3">
                <For each={results()}>
                  {(result, index) => (
                    <li class="flex min-w-0 flex-col gap-1">
                      <img
                        src={result.src}
                        alt={ctx.t("alt", { index: index() + 1 })}
                        class="w-full rounded-md border border-v2-border-border-base object-contain"
                      />
                      <span
                        class="break-all text-12-regular"
                        classList={{
                          "text-v2-text-text-faint": "path" in result.saved,
                          "text-v2-state-fg-danger": "error" in result.saved,
                        }}
                      >
                        {"path" in result.saved
                          ? ctx.t("saved", { path: result.saved.path })
                          : ctx.t("save.failed", { error: result.saved.error })}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Match>
      </Switch>
    </ui.Dialog>
  )
}
