import { createMemo, createSignal, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { checksum } from "@opencode/util/encode"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { Accordion } from "@opencode/ui/accordion"
import { StickyAccordionHeader } from "@opencode/ui/sticky-accordion-header"
import { showToast } from "@opencode/ui/toast"
import { useI18n } from "@opencode/ui/context/i18n"
import { File } from "@opencode/session-ui/file"
import { Markdown } from "@opencode/session-ui/markdown"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { createKeyed, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { catalogModel, syncCatalog } from "./catalog"
import { fetchSessionExport, sessionExportFilename } from "./export"
import { createSessionContextFormatter, statShare, usageTone, type StatTone } from "./format"
import {
  createContextScrollState,
  createSessionExportState,
  selectSessionExporting,
  transitionContextScroll,
  transitionSessionExport,
  type ContextScrollEffect,
  type ContextScrollEvent,
  type SessionExportEffect,
  type SessionExportEvent,
} from "./machine"

const toneColor = {
  success: "var(--v2-state-fg-success)",
  warning: "var(--v2-state-fg-warning)",
  danger: "var(--v2-state-fg-danger)",
  info: "var(--v2-state-fg-info)",
  accent: "var(--v2-text-text-accent)",
} satisfies Record<StatTone, string>

type StatPart = { tone: StatTone; share: number | undefined }

function Stat(props: { label: string; value: JSX.Element; tone?: StatTone; parts?: StatPart[]; caption?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="flex items-baseline gap-2">
        <div class="text-12-medium text-text-strong" style={{ color: props.tone && toneColor[props.tone] }}>
          {props.value}
        </div>
        <Show when={props.caption}>
          <div class="text-12-regular text-text-weak">{props.caption}</div>
        </Show>
      </div>
      <Show when={props.parts}>
        {(parts) => (
          <div
            aria-hidden="true"
            class="flex h-1.5 w-full max-w-64 rounded-full overflow-hidden"
            style={{ background: "var(--v2-border-border-muted)" }}
          >
            <For each={parts()}>
              {(part) => (
                <div
                  class="h-full"
                  style={{
                    // A sliver stays visible so a small part still reads as present rather than missing.
                    width: part.share ? `max(${part.share * 100}%, 2px)` : "0",
                    background: toneColor[part.tone],
                    transition: "width 300ms ease-out",
                  }}
                />
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}

function RawMessageContent(props: { message: SessionMessageInfo; onRendered: () => void }) {
  const file = createMemo(() => {
    const contents = JSON.stringify(props.message, null, 2)

    return {
      name: `${props.message.type}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return <File mode="text" file={file()} overflow="wrap" class="select-text" onRendered={props.onRendered} />
}

function RawMessage(props: {
  message: SessionMessageInfo
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.type} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

const emptyMessages: SessionMessageInfo[] = []

export default function SessionContextTab(props: { session: MountedSession }) {
  const ctx = usePlugin()
  const layout = ctx.layout
  const system = ctx.system
  const i18n = useI18n()
  const data = () => props.session.server.data
  syncCatalog(() => props.session)

  const info = createMemo(() => (props.session.id ? data().session.get(props.session.id) : undefined))

  const messages = createMemo(
    () => {
      const id = props.session.id

      if (!id) return emptyMessages

      return data().session.message.list(id)
    },
    emptyMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  // Same step as the TUI and the header button: after the last completed compaction and before an undo boundary.
  const context = createMemo(() => {
    const message = lastAssistantWithUsage(messages(), info()?.revert?.messageID)

    if (!message) return
    const entry = catalogModel(props.session, message.model)

    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write

    return {
      message,
      tokens: message.tokens,
      providerLabel: entry?.provider.name ?? message.model.providerID,
      modelLabel: entry?.model?.name ?? message.model.id,
      limit: entry?.model?.limit.context,
      input: message.tokens.input,
      total,
      usage: entry?.model?.limit.context ? Math.round((total / entry.model.limit.context) * 100) : null,
    }
  })

  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const cost = createMemo(() => {
    if (!props.session.id) return
    const spent = data().session.cost(props.session.id)

    if (spent === 0) {
      const ref = info()?.model ?? messages().findLast((item) => item.type === "assistant")?.model

      if (ref?.providerID === "opencode-go") return
    }

    return usd().format(spent)
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, message) => count + (message.type === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, message) => count + (message.type === "assistant" ? 1 : 0), 0)

    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const system = messages().findLast((message) => message.type === "system")?.text

    if (!system) return
    const trimmed = system.trim()

    if (!trimmed) return

    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.modelLabel
  })

  // A bar always measures against something named beside it: the context against its limit, and a total against
  // the colored numbers that add up to it. A number alone gets no bar, since nothing says what would fill it.
  const stats = [
    { label: "stats.session", value: () => info()?.title ?? (props.session.id || "—") },
    {
      label: "stats.messages",
      value: () => counts().all.toLocaleString(i18n.locale()),
      parts: () => [
        { tone: "info" as const, share: statShare(counts().user, counts().all) },
        { tone: "accent" as const, share: statShare(counts().assistant, counts().all) },
      ],
    },
    { label: "stats.provider", value: providerLabel },
    { label: "stats.model", value: modelLabel },
    { label: "stats.limit", value: () => formatter().number(context()?.limit) },
    {
      label: "stats.totalTokens",
      value: () => formatter().number(context()?.total),
      parts: () => {
        const c = context()

        if (!c) return

        return [
          { tone: "info" as const, share: statShare(c.input, c.total) },
          { tone: "success" as const, share: statShare(c.tokens.cache.read + c.tokens.cache.write, c.total) },
          { tone: "accent" as const, share: statShare(c.tokens.output, c.total) },
          { tone: "warning" as const, share: statShare(c.tokens.reasoning, c.total) },
        ]
      },
    },
    {
      label: "stats.usage",
      value: () => formatter().percent(context()?.usage),
      tone: () => usageTone(context()?.usage),
      caption: () => {
        const c = context()

        if (!c?.limit) return

        return `${formatter().number(c.total)} / ${formatter().number(c.limit)}`
      },
      parts: () => {
        const tone = usageTone(context()?.usage)

        return tone && [{ tone, share: statShare(context()?.total, context()?.limit) }]
      },
    },
    { label: "stats.inputTokens", value: () => formatter().number(context()?.input), tone: () => "info" as const },
    {
      label: "stats.outputTokens",
      value: () => formatter().number(context()?.tokens.output),
      tone: () => "accent" as const,
    },
    {
      label: "stats.reasoningTokens",
      value: () => formatter().number(context()?.tokens.reasoning),
      tone: () => "warning" as const,
    },
    {
      label: "stats.cacheTokens",
      value: () =>
        `${formatter().number(context()?.tokens.cache.read)} / ${formatter().number(context()?.tokens.cache.write)}`,
      tone: () => "success" as const,
    },
    {
      label: "stats.userMessages",
      value: () => counts().user.toLocaleString(i18n.locale()),
      tone: () => "info" as const,
    },
    {
      label: "stats.assistantMessages",
      value: () => counts().assistant.toLocaleString(i18n.locale()),
      tone: () => "accent" as const,
    },
    { label: "stats.totalCost", value: cost },
    { label: "stats.sessionCreated", value: () => formatter().time(info()?.time.created) },
    { label: "stats.lastActivity", value: () => formatter().time(context()?.message.time.created) },
  ] satisfies {
    label: string
    value: () => JSX.Element
    tone?: () => StatTone | undefined
    parts?: () => StatPart[] | undefined
    caption?: () => string | undefined
  }[]

  const [exportState, setExportState] = createSignal(createSessionExportState())
  const exportControllers = new Map<number, AbortController>()
  const exporting = () => selectSessionExporting(exportState(), props.session.key)

  const dispatchExport = (event: SessionExportEvent) => {
    const next = transitionSessionExport(exportState(), event)

    setExportState(next.state)
    next.effects.forEach(
      (effect) =>
        void Promise.try(() => runExport(effect)).catch((cause: unknown) => console.error("[context] export", cause)),
    )
  }

  const runExport = (effect: SessionExportEffect) => {
    if (effect.type === "export.fetch") {
      const controller = new AbortController()

      const failed = (cause: unknown) =>
        dispatchExport({
          type: "export.failed",
          attempt: effect.attempt,
          sessionKey: effect.sessionKey,
          message: cause instanceof Error ? cause.message : undefined,
        })

      exportControllers.set(effect.attempt, controller)
      // Runs inside the click that asked for it, so the routed session is the one being exported.
      const api = props.session.server.client
      void Promise.try(() => fetchSessionExport({ sessionID: effect.sessionID, api, signal: controller.signal }))
        .then(
          (data) =>
            dispatchExport({ type: "export.fetched", attempt: effect.attempt, sessionKey: effect.sessionKey, data }),
          failed,
        )
        .finally(() => exportControllers.delete(effect.attempt))

      return
    }

    if (effect.type === "export.save") {
      const filename = sessionExportFilename(effect.data.info)

      void Promise.try(() => system.save({ name: filename, content: JSON.stringify(effect.data, null, 2) })).then(
        (saved) =>
          dispatchExport({
            type: "export.saved",
            attempt: effect.attempt,
            sessionKey: effect.sessionKey,
            filename,
            saved,
          }),
        (cause: unknown) =>
          dispatchExport({
            type: "export.failed",
            attempt: effect.attempt,
            sessionKey: effect.sessionKey,
            message: cause instanceof Error ? cause.message : undefined,
          }),
      )

      return
    }

    if (effect.type === "export.abort") return exportControllers.get(effect.attempt)?.abort()

    if (effect.type === "toast.exported") {
      return void showToast({
        variant: "success",
        // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
        icon: () => <Icon name="circle-check" />,
        title: ctx.t("export.success.title"),
        description: ctx.t("export.success.description", { filename: effect.filename }),
      })
    }

    showToast({
      variant: "error",
      title: ctx.t("export.failed.title"),
      description: effect.message ?? ctx.t("export.failed.description"),
    })
  }

  const exportSession = () => {
    if (!props.session.id) return
    dispatchExport({ type: "export.requested", sessionKey: props.session.key, sessionID: props.session.id })
  }

  onCleanup(() => dispatchExport({ type: "disposed" }))

  let scrollState = createContextScrollState()
  let scroller: HTMLDivElement | undefined
  let frame: number | undefined
  // The session the scroll machine last targeted; a switch writes its final offset after props.session moved on.
  let scrollSession: MountedSession | undefined
  const contentChanged: ContextScrollEvent = { type: "content.changed" }
  const interacted: ContextScrollEvent = { type: "interacted" }

  const dispatchScroll = (event: ContextScrollEvent) => {
    const next = transitionContextScroll(scrollState, event)

    scrollState = next.state
    next.effects.forEach(
      (effect) =>
        void Promise.try(() => runScroll(effect)).catch((cause: unknown) => console.error("[context] scroll", cause)),
    )
  }

  const runScroll = (effect: ContextScrollEffect) => {
    if (effect.type === "save.write") {
      const session = props.session.key === effect.sessionKey ? props.session : scrollSession

      if (session?.key === effect.sessionKey) layout.scroll.set(session, "context", effect.position)

      return
    }

    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined

    if (effect.type === "frame.cancel") return

    frame = requestAnimationFrame(() => {
      frame = undefined

      if (effect.kind === "save") return dispatchScroll({ type: "save.flushed", attempt: effect.attempt })

      dispatchScroll({ type: "restore.applied", attempt: effect.attempt, applied: restoreScroll() })
    })
  }

  /** Applies the stored offset, or the top for a session without one, and returns where the scroller moved to. */
  const restoreScroll = () => {
    const el = scroller

    if (!el) return
    const stored = layout.scroll.get(props.session, "context") ?? { x: 0, y: 0 }
    const before = { x: el.scrollLeft, y: el.scrollTop }

    if (el.scrollTop !== stored.y) el.scrollTop = stored.y

    if (el.scrollLeft !== stored.x) el.scrollLeft = stored.x

    if (el.scrollTop === before.y && el.scrollLeft === before.x) return

    return { x: el.scrollLeft, y: el.scrollTop }
  }

  // Follows the routed session and whether its stored layout can be read.
  createKeyed(
    () => ({ session: props.session, active: layout.ready() && props.session.location !== undefined }),
    (target) => {
      dispatchScroll({ type: "target.synced", sessionKey: target.session.key, active: target.active })
      scrollSession = target.session
    },
    { equals: (previous, next) => previous.session.key === next.session.key && previous.active === next.active },
  )

  // New messages grow the content, so a restore clamped by shorter content can now reach its offset.
  createKeyed(createMemo(on(messages, (list) => list, { defer: true })), () => dispatchScroll(contentChanged))

  // Writes the offset the save frame has not stored yet.
  onCleanup(() => dispatchScroll({ type: "disposed" }))

  return (
    <div
      class="@container h-full overflow-y-auto"
      data-scrollable
      ref={(el) => {
        scroller = el
        // Input of the user's own takes over from restoring, even before it scrolls.
        makeEventListener(el, "wheel", () => dispatchScroll(interacted), { passive: true })
        makeEventListener(el, "pointerdown", () => dispatchScroll(interacted), { passive: true })
        makeEventListener(el, "touchstart", () => dispatchScroll(interacted), { passive: true })
        makeEventListener(el, "keydown", () => dispatchScroll(interacted))
      }}
      onScroll={(event) =>
        dispatchScroll({
          type: "scrolled",
          position: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
        })
      }
    >
      <div data-slot="session-usage-content" class="px-4 pt-4 pb-6 flex flex-col gap-6 md:px-6 md:pb-10 md:gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats}>
            {(stat) => (
              <Show when={stat.value()}>
                {(value) => (
                  <Stat
                    label={ctx.t(stat.label)}
                    value={value()}
                    tone={stat.tone?.()}
                    parts={stat.parts?.()}
                    caption={stat.caption?.()}
                  />
                )}
              </Show>
            )}
          </For>
        </div>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{ctx.t("systemPrompt.title")}</div>
              <div class="border border-v2-border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-12-regular text-text-weak">{ctx.t("rawMessages.title")}</div>
            <Button
              size="small"
              variant="ghost"
              class="gap-1.5 px-2 text-text-weak hover:text-text-base"
              disabled={!props.session.id || exporting()}
              onClick={exportSession}
            >
              <Show when={exporting()} fallback={<Icon name="download" />}>
                <Loader class="size-4 shrink-0" />
              </Show>
              <span>{ctx.t("export.session")}</span>
            </Button>
          </div>
          <Accordion multiple>
            <For each={messages()}>
              {(message) => (
                <RawMessage
                  message={message}
                  onRendered={() => dispatchScroll(contentChanged)}
                  time={formatter().time}
                />
              )}
            </For>
          </Accordion>
        </div>
      </div>
    </div>
  )
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true

  if (!a || !b) return false

  if (a.length !== b.length) return false

  return a.every((x, i) => x === b[i])
}
