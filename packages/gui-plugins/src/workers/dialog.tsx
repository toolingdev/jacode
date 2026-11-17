import { usePlugin } from "@opencode/plugin/gui"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { Ssh } from "../ssh/contract"
import { Workers, type WorkerReport, type WorkerRequest } from "./contract"
import type definition from "./index"

type Where = "server" | "vps" | "docker" | "link"

const PLACES: readonly Where[] = ["server", "vps", "docker", "link"]

const BROWSER: readonly WorkerRequest["browser"][] = ["auto", "yes", "no"]

/** The guided way to add a worker: where it runs, then that place's own steps. */
export default function AddWorker(props: { onClose: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const workers = ctx.use(Workers)
  const ssh = ctx.use(Ssh)

  const [where, setWhere] = createSignal<Where>()
  const [target, setTarget] = createSignal("")
  const [name, setName] = createSignal("")
  const [browser, setBrowser] = createSignal<WorkerRequest["browser"]>("auto")
  // What is running now, and what each finished step came to.
  const [busy, setBusy] = createSignal<"check" | "install" | "connect" | "docker">()
  const [checked, setChecked] = createSignal<WorkerReport>()
  const [installed, setInstalled] = createSignal<WorkerReport>()
  const [connected, setConnected] = createSignal<boolean>()
  const [docked, setDocked] = createSignal<WorkerReport>()

  let body: HTMLDivElement | undefined

  // Each step's outcome appears under the form, so it is brought into view once it is drawn.
  const reveal = () => requestAnimationFrame(() => body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" }))

  const request = (): WorkerRequest => ({ target: target().trim(), browser: browser() })

  const run = (step: "check" | "install") => {
    const live = workers()

    if (live.status !== "active" || busy()) return
    setBusy(step)
    reveal()
    void live.value[step](request()).then(
      (report) => {
        ;(step === "check" ? setChecked : setInstalled)(report)
        setBusy()
        reveal()
      },
      () => {
        ;(step === "check" ? setChecked : setInstalled)({
          passed: false,
          checks: [],
          output: "",
          failure: "connection",
        })
        setBusy()
        reveal()
      },
    )
  }

  // The worker listens on its own machine only, so the app reaches it through the SSH plugin's tunnel.
  const connect = () => {
    const live = ssh()

    if (live.status !== "active" || busy()) return
    setBusy("connect")
    reveal()
    void live.value.start({ id: crypto.randomUUID(), target: request().target, name: name().trim() }).then(
      () => {
        setConnected(true)
        setBusy()
        reveal()
      },
      () => {
        setConnected(false)
        setBusy()
        reveal()
      },
    )
  }

  // Builds and starts the Docker worker; the plugin's own server source then lists it, connected.
  const dock = () => {
    const live = workers()

    if (live.status !== "active" || busy()) return
    setBusy("docker")
    reveal()
    void live.value.dockerStart({ name: name().trim() || ctx.t("name.placeholder") }).then(
      (found) => {
        setDocked(found)
        setBusy()
        reveal()
      },
      () => {
        setDocked({ passed: false, checks: [], output: "", failure: "docker" })
        setBusy()
        reveal()
      },
    )
  }

  const existing = () => {
    const live = workers()

    // The one being made right now is not a reason to refuse making it.
    return live.status === "active" && !!live.value.state()?.docker && !docked() && busy() !== "docker"
  }

  const models = () => {
    props.onClose()
    ctx.layout.settings("providers")
  }

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    // A changed address is another machine: what was found out about the old one no longer holds.
    setChecked()
    setInstalled()
    setConnected()
  }

  const report = (found: WorkerReport, passed: string, failed: string) => (
    <div class="flex flex-col gap-2">
      <Show when={found.checks.length > 0}>
        <ul class="flex flex-col gap-1 rounded-[8px] border border-v2-border-border-muted p-2.5 text-12-regular">
          <For each={found.checks}>
            {(check) => (
              <li class="flex items-baseline gap-2">
                <span
                  class="w-2 shrink-0"
                  classList={{
                    "text-v2-state-fg-success": check.status === "ok",
                    "text-v2-state-fg-warning": check.status === "note",
                    "text-v2-state-fg-danger": check.status === "fail",
                  }}
                  aria-hidden="true"
                >
                  ●
                </span>
                <span class="w-28 shrink-0 text-v2-text-text-base">{check.name}</span>
                <span class="min-w-0 text-v2-text-text-muted">{check.detail}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p
        class="text-13-medium"
        classList={{ "text-v2-state-fg-success": found.passed, "text-v2-state-fg-danger": !found.passed }}
      >
        {found.failure ? ctx.t(`failure.${found.failure}`) : ctx.t(found.passed ? passed : failed)}
      </p>
      <Show when={!found.passed && found.output}>
        <details class="text-12-regular text-v2-text-text-muted">
          <summary class="cursor-pointer">{ctx.t("details")}</summary>
          <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-[6px] bg-v2-background-bg-deep p-2 font-mono text-[11px]">
            {found.output}
          </pre>
        </details>
      </Show>
    </div>
  )

  const field = (label: string, hint: string, input: () => ReturnType<typeof ui.TextInput>) => (
    <label class="flex flex-col gap-1">
      <span class="text-12-medium text-v2-text-text-muted">{label}</span>
      {input()}
      <span class="text-12-regular text-v2-text-text-muted">{hint}</span>
    </label>
  )

  const overSsh = (place: "server" | "vps") => (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1 text-12-regular text-v2-text-text-muted">
        <span class="text-12-medium text-v2-text-text-base">{ctx.t("need.title")}</span>
        <ul class="list-disc ps-4">
          <li>{ctx.t("need.system")}</li>
          <li>{ctx.t("need.size")}</li>
          <li>{ctx.t("need.browser")}</li>
          <li>{ctx.t("need.login")}</li>
        </ul>
        <span>{ctx.t("need.checked")}</span>
      </div>
      {field(ctx.t("address.label"), ctx.t(`address.hint.${place}`), () => (
        <ui.TextInput
          label={ctx.t("address.label")}
          placeholder={ctx.t("address.placeholder")}
          size="large"
          class="w-full"
          value={target()}
          onInput={edit(setTarget)}
          onSubmit={() => run("check")}
        />
      ))}
      {field(ctx.t("name.label"), ctx.t("name.hint"), () => (
        <ui.TextInput
          label={ctx.t("name.label")}
          placeholder={ctx.t("name.placeholder")}
          size="large"
          class="w-full"
          value={name()}
          onInput={setName}
        />
      ))}
      <div class="flex flex-col gap-1">
        <span class="text-12-medium text-v2-text-text-muted">{ctx.t("browser.label")}</span>
        <div class="flex flex-wrap gap-2">
          <For each={BROWSER}>
            {(choice) => (
              <ui.Button
                size="small"
                variant={browser() === choice ? "neutral" : "ghost"}
                onClick={() => setBrowser(choice)}
              >
                {ctx.t(`browser.${choice}`)}
              </ui.Button>
            )}
          </For>
        </div>
      </div>
      <Show when={busy()}>
        {(step) => <p class="text-13-regular text-v2-text-text-muted">{ctx.t(`${step()}.running`)}</p>}
      </Show>
      <Show when={!busy() && !installed() && checked()}>
        {(found) => report(found(), "check.passed", "check.failed")}
      </Show>
      <Show when={!busy() && installed()}>{(found) => report(found(), "install.passed", "install.failed")}</Show>
      <Show when={!busy() && connected() !== undefined}>
        <p
          class="text-13-medium"
          classList={{ "text-v2-state-fg-success": connected(), "text-v2-state-fg-danger": !connected() }}
        >
          {ctx.t(connected() ? "connect.passed" : "connect.failed")}
        </p>
      </Show>
      <Show when={installed()?.passed}>
        <div class="rounded-[8px] border border-v2-border-border-muted p-2.5 text-12-regular text-v2-text-text-muted">
          <span class="text-12-medium text-v2-text-text-base">{ctx.t("model.title")}</span>
          <p>{ctx.t("model.about")}</p>
        </div>
      </Show>
    </div>
  )

  // The one button that moves the SSH steps along: check, then install, then connect, then done.
  const next = () => {
    if (connected()) return { label: ctx.t("models.run"), run: models }

    if (installed()?.passed) return { label: ctx.t("connect.run"), run: connect }

    if (checked()?.passed) return { label: ctx.t("install.run"), run: () => run("install") }

    return { label: ctx.t(checked() ? "check.again" : "check.run"), run: () => run("check") }
  }

  return (
    <ui.Dialog
      title={ctx.t("wizard.title")}
      description={where() ? ctx.t(`where.${where() ?? "server"}`) : ctx.t("where.description")}
      footer={
        <>
          <Show
            when={where()}
            fallback={
              <ui.Button variant="ghost" onClick={props.onClose}>
                {ctx.t("wizard.close")}
              </ui.Button>
            }
          >
            <ui.Button variant="ghost" disabled={!!busy()} onClick={() => setWhere()}>
              {ctx.t("wizard.back")}
            </ui.Button>
          </Show>
          <Switch>
            <Match when={where() === "server" || where() === "vps"}>
              <ui.Button variant="contrast" disabled={!!busy() || target().trim() === ""} onClick={() => next().run()}>
                {next().label}
              </ui.Button>
            </Match>
            <Match when={where() === "docker" && docked()?.passed}>
              <ui.Button variant="neutral" onClick={props.onClose}>
                {ctx.t("wizard.done")}
              </ui.Button>
              <ui.Button variant="contrast" onClick={models}>
                {ctx.t("models.run")}
              </ui.Button>
            </Match>
            <Match when={where() === "docker"}>
              <ui.Button variant="contrast" disabled={!!busy() || existing()} onClick={dock}>
                {ctx.t("docker.run")}
              </ui.Button>
            </Match>
            <Match when={where() === "link"}>
              <ui.Button variant="contrast" onClick={props.onClose}>
                {ctx.t("wizard.done")}
              </ui.Button>
            </Match>
          </Switch>
        </>
      }
    >
      {/* The steps grow as they are answered; they scroll inside the dialog so its buttons stay in reach. */}
      <div ref={body} class="max-h-[56vh] overflow-y-auto pe-1">
        <Switch>
          <Match when={!where()}>
            <div class="flex flex-col gap-2">
              <For each={PLACES}>
                {(place) => (
                  <button
                    type="button"
                    class="flex flex-col gap-0.5 rounded-[8px] border border-v2-border-border-muted p-3 text-start hover:bg-v2-overlay-simple-overlay-hover"
                    onClick={() => setWhere(place)}
                  >
                    <span class="text-13-medium text-v2-text-text-base">{ctx.t(`where.${place}`)}</span>
                    <span class="text-12-regular text-v2-text-text-muted">{ctx.t(`where.${place}.about`)}</span>
                  </button>
                )}
              </For>
            </div>
          </Match>
          <Match when={where() === "server"}>{overSsh("server")}</Match>
          <Match when={where() === "vps"}>{overSsh("vps")}</Match>
          <Match when={where() === "docker"}>
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-1 text-12-regular text-v2-text-text-muted">
                <p>{ctx.t("docker.about")}</p>
                <p>{ctx.t("docker.need")}</p>
              </div>
              <Show
                when={!existing()}
                fallback={<p class="text-13-medium text-v2-state-fg-warning">{ctx.t("docker.exists")}</p>}
              >
                {field(ctx.t("name.label"), ctx.t("name.hint"), () => (
                  <ui.TextInput
                    label={ctx.t("name.label")}
                    placeholder={ctx.t("name.placeholder")}
                    size="large"
                    class="w-full"
                    value={name()}
                    onInput={setName}
                    onSubmit={dock}
                  />
                ))}
              </Show>
              <Show when={busy() === "docker"}>
                <p class="text-13-regular text-v2-text-text-muted">{ctx.t("docker.running")}</p>
              </Show>
              <Show when={!busy() && docked()}>{(found) => report(found(), "docker.passed", "docker.failed")}</Show>
              <Show when={docked()?.passed}>
                <div class="rounded-[8px] border border-v2-border-border-muted p-2.5 text-12-regular text-v2-text-text-muted">
                  <span class="text-12-medium text-v2-text-text-base">{ctx.t("model.title")}</span>
                  <p>{ctx.t("model.about")}</p>
                </div>
              </Show>
            </div>
          </Match>
          <Match when={where() === "link"}>
            <p class="text-13-regular text-v2-text-text-muted">{ctx.t("link.about")}</p>
          </Match>
        </Switch>
      </div>
    </ui.Dialog>
  )
}
