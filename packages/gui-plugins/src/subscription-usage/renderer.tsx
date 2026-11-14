import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createLatest, Slot, usePlugin, type MountedSession, type Plugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { Menu } from "@opencode/ui/menu"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import type definition from "./index"
import { headline, meterRows, modelRows } from "./view"

/** How often the header reloads the allowances while its session is on screen. */
const REFRESH_MS = 30_000

/**
 * What the flat-rate subscriptions of the session's providers have used, in the session header: the allowance closest
 * to its limit as a ring, and every allowance in a menu. Renders nothing while no provider reports a subscription.
 */
function SubscriptionUsage(props: { session: MountedSession; active: boolean; compact: boolean }) {
  const ctx = usePlugin<typeof definition>()
  const i18n = useI18n()
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((value) => value + 1), REFRESH_MS)

  onCleanup(() => clearInterval(timer))

  // A string key, so only another session, location or tick loads again. A hidden cached timeline loads nothing.
  const usage = createLatest(
    () => {
      const location = props.session.location

      return (
        props.active &&
        location &&
        JSON.stringify([props.session.key, location.directory, location.workspaceID ?? null, tick()])
      )
    },
    // The live server ref each time: a restarted server gets a new client under the same id.
    (_key, signal) =>
      props.session.server.client.experimental.usage
        .subscriptions({ location: props.session.location }, { signal })
        .then((output) => output.data),
  )

  const [open, setOpen] = createSignal(false)

  // Loaded each time the menu opens: the history changes with every request, and nothing shows it while closed.
  const history = createLatest(
    () => {
      const location = props.session.location

      return open() && location && JSON.stringify([props.session.key, location.directory, location.workspaceID ?? null])
    },
    (_key, signal) =>
      props.session.server.client.experimental.usage
        .history({ location: props.session.location }, { signal })
        .then((output) => output.data),
  )

  const models = createMemo(() => modelRows(history.latest ?? []))
  const usd = createMemo(() => new Intl.NumberFormat(i18n.locale(), { style: "currency", currency: "USD" }))

  const rows = createMemo(() => meterRows(usage.latest ?? []))
  const inactive = createMemo(() => (usage.latest ?? []).filter((subscription) => !subscription.active))

  const amount = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const time = createMemo(
    () => new Intl.DateTimeFormat(i18n.locale(), { weekday: "short", hour: "numeric", minute: "numeric" }),
  )

  return (
    <Show when={headline(rows())}>
      {(main) => (
        <Menu placement="bottom-end" gutter={4} modal={false} onOpenChange={setOpen}>
          <Tooltip value={ctx.t("view")} placement="bottom">
            <Menu.Trigger
              as={Button}
              type="button"
              variant="ghost-muted"
              class="group shrink-0"
              style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
              aria-label={ctx.t("view")}
            >
              <span class="flex items-center gap-2 whitespace-nowrap group-active:text-v2-text-text-muted">
                <ProgressCircle appearance="compact" size={16} percentage={main().percent} />
                <Show when={!props.compact}>
                  <span class="tabular-nums">{ctx.t(`short.${main().window}`, { percent: main().percent })}</span>
                </Show>
              </span>
            </Menu.Trigger>
          </Tooltip>
          <Menu.Portal>
            <Menu.Content class="w-[300px] max-w-[calc(100vw-16px)]" aria-label={ctx.t("view")}>
              <For each={rows()}>
                {(row) => (
                  <div class="flex flex-col px-3 py-1.5 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
                    <div class="flex min-w-0 items-center gap-4">
                      <span class="shrink-0 text-v2-text-text-muted">{ctx.t(`meter.${row.unit}.${row.window}`)}</span>
                      <span class="ml-auto min-w-0 truncate text-right tabular-nums text-v2-text-text-base">
                        {amount().format(row.used)} / {amount().format(row.limit)} · {row.percent}%
                      </span>
                    </div>
                    <span class="text-v2-text-text-faint">
                      {ctx.t("resets", { time: time().format(row.resetsAt) })}
                    </span>
                  </div>
                )}
              </For>
              <For each={inactive()}>
                {(subscription) => (
                  <div class="px-3 py-1.5 text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-state-fg-danger">
                    {ctx.t("inactive", { name: subscription.name })}
                  </div>
                )}
              </For>
              <Menu.Separator />
              <div class="px-3 pt-1.5 pb-1 text-[12px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                {ctx.t("history.title")}
              </div>
              <div class="max-h-[240px] overflow-y-auto pb-1 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
                <Switch>
                  <Match when={models().length > 0}>
                    <For each={models()}>
                      {(row) => (
                        <div class="flex flex-col px-3 py-1">
                          <div class="flex min-w-0 items-center gap-4">
                            <span class="min-w-0 truncate text-v2-text-text-muted">{row.model}</span>
                            <span class="ml-auto shrink-0 tabular-nums text-v2-text-text-base">
                              {ctx.t("history.tokens", {
                                input: amount().format(row.input),
                                output: amount().format(row.output),
                              })}
                            </span>
                          </div>
                          <span class="tabular-nums text-v2-text-text-faint">
                            {ctx.t("history.requests", { count: row.requests.toLocaleString(i18n.locale()) })}
                            <Show when={row.cost > 0}> · {usd().format(row.cost)}</Show>
                          </span>
                        </div>
                      )}
                    </For>
                  </Match>
                  <Match when={history.error !== undefined}>
                    <div class="px-3 py-1 text-v2-text-text-faint">{ctx.t("history.failed")}</div>
                  </Match>
                  <Match when={history.latest !== undefined}>
                    <div class="px-3 py-1 text-v2-text-text-faint">{ctx.t("history.empty")}</div>
                  </Match>
                </Switch>
              </div>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      )}
    </Show>
  )
}

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  ctx.add(Slot, {
    at: "session.header",
    order: 20,
    render: (input) => <SubscriptionUsage session={input.session} active={input.active} compact={input.compact} />,
  })
}

export default setup
