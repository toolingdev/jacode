import type { UsageSubscriptionHistory, UsageSubscriptionInfo, UsageSubscriptionMeter } from "@opencode/client/promise"

/** One allowance as the header menu lists it. */
export type MeterRow = {
  readonly key: string
  readonly unit: UsageSubscriptionMeter["unit"]
  readonly window: UsageSubscriptionMeter["window"]
  readonly used: number
  readonly limit: number
  /** How much of the allowance is used, from 0 to 100. */
  readonly percent: number
  readonly resetsAt: number
}

/** Every allowance of the loaded subscriptions, in the order the server lists them. */
export function meterRows(subscriptions: readonly UsageSubscriptionInfo[]): readonly MeterRow[] {
  return subscriptions.flatMap((subscription) =>
    subscription.meters.map((meter) => ({
      key: `${subscription.providerID}\n${meter.unit}\n${meter.window}`,
      unit: meter.unit,
      window: meter.window,
      used: meter.used,
      limit: meter.limit,
      percent: meter.limit > 0 ? Math.min(100, Math.round((meter.used / meter.limit) * 100)) : 100,
      resetsAt: meter.resetsAt,
    })),
  )
}

/** The allowance the header shows: the token allowance closest to its limit, since that one stops chat first. */
export function headline(rows: readonly MeterRow[]): MeterRow | undefined {
  const tokens = rows.filter((row) => row.unit === "input_tokens")

  return (tokens.length > 0 ? tokens : rows).toSorted((a, b) => b.percent - a.percent)[0]
}

/** One model of the 30-day history as the header menu lists it. */
export type ModelRow = {
  readonly key: string
  readonly model: string
  readonly requests: number
  readonly input: number
  readonly output: number
  readonly cost: number
}

/** Every model the histories recorded, the one that used the most tokens first. */
export function modelRows(histories: readonly UsageSubscriptionHistory[]): readonly ModelRow[] {
  return histories
    .flatMap((history) =>
      history.models.map((entry) => ({
        key: `${history.providerID}\n${entry.model}`,
        model: entry.model,
        requests: entry.requests,
        input: entry.tokens.input,
        output: entry.tokens.output,
        cost: entry.cost,
      })),
    )
    .toSorted((a, b) => b.input + b.output - (a.input + a.output))
}
