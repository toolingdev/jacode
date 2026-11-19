import { ConfigProvider } from "@opencode/schema/config/provider"
import { Cause, Exit, Option, Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Textarea } from "@opencode/ui/textarea"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"

// Fork feature: a provider set up in a config file, shown and edited in the app. Saving writes the provider's entry
// back to that file; the server reloads config when it changes, so the edit applies at once.
type Payload = Parameters<ReturnType<typeof useServerSDK>["api"]["experimental"]["config"]["providers"]["set"]>[0]["payload"]

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export function DialogProviderConfig(props: { id: string; name: string }) {
  const language = useLanguage()
  const server = useServerSDK()
  const dialog = useDialog()
  const [text, setText] = createSignal("")
  const [file, setFile] = createSignal("")

  const [state, setState] = createSignal<{ kind: "idle" | "valid" | "saving" } | { kind: "error"; message: string }>({
    kind: "idle",
  })

  // Read as the file writes it, so `{env:...}` stays a reference and a secret written out in full comes back hidden.
  void server.api.experimental.config.providers.get({ provider: props.id }).then(
    (result) => {
      setFile(result.path)
      setText(JSON.stringify(result.entry ?? {}, null, 2))
    },
    (error) => setState({ kind: "error", message: formatServerError(error, language.t) }),
  )


  // Checked here against the same schema the server reads, so a mistake shows before anything is written.
  const parse = () => {
    const json = decodeJson(text())

    if (Option.isNone(json)) return { ok: false as const, message: language.t("settings.providers.config.json") }
    const exit = Schema.decodeUnknownExit(ConfigProvider.Info)(json.value)

    if (Exit.isFailure(exit)) return { ok: false as const, message: Cause.pretty(exit.cause) }

    // SAFETY: the JSON decoded as a provider entry above, which is the payload the endpoint takes.
    return { ok: true as const, value: json.value as Payload }
  }

  const message = () => {
    const current = state()

    return current.kind === "error" ? current.message : undefined
  }

  const check = () => {
    const result = parse()

    setState(result.ok ? { kind: "valid" } : { kind: "error", message: result.message })
  }

  const save = () => {
    const result = parse()

    if (!result.ok) return setState({ kind: "error", message: result.message })
    setState({ kind: "saving" })
    void server.api.experimental.config.providers.set({ provider: props.id, payload: result.value }).then(
      () => dialog.close(),
      (error) => setState({ kind: "error", message: formatServerError(error, language.t) }),
    )
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.providers.config.title", { provider: props.name })}
          description={language.t("settings.providers.config.description", { file: file() })}
        />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-2">
          <Textarea
            rows={14}
            spellcheck={false}
            class="w-full font-mono text-12-regular"
            value={text()}
            invalid={state().kind === "error"}
            onInput={(event) => {
              setText(event.currentTarget.value)
              setState({ kind: "idle" })
            }}
            aria-label={language.t("settings.providers.config.title", { provider: props.name })}
          />
          <p class="text-12-regular text-v2-text-text-muted">{language.t("settings.providers.config.secrets")}</p>
          <Show when={state().kind === "valid"}>
            <p class="text-12-regular text-v2-state-fg-success">{language.t("settings.providers.config.valid")}</p>
          </Show>
          <Show when={message()}>
            {(message) => <p class="text-12-regular text-v2-state-fg-danger">{message()}</p>}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" size="normal" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="neutral" size="normal" onClick={check}>
          {language.t("settings.providers.config.check")}
        </Button>
        <Button variant="submit" size="normal" disabled={state().kind === "saving"} onClick={save}>
          {language.t("settings.providers.config.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
