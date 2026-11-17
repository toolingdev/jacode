export function createSessionContextFormatter(locale: string) {
  // The fields luxon's DATETIME_MED preset passed to Intl; output is identical.
  const dateTime = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  })

  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"

      if (value === null) return "—"

      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"

      if (value === null) return "—"

      return value.toLocaleString(locale) + "%"
    },
    time(value: number | undefined) {
      if (!value) return "—"

      return dateTime.format(value)
    },
  }
}

// Fork feature: the context view colors its numbers and draws them as bars, so a session reads at a glance.
export type StatTone = "success" | "warning" | "danger" | "info" | "accent"

/** How full the context is: comfortable, filling up, or close to the limit. */
export function usageTone(percent: number | null | undefined): StatTone | undefined {
  if (percent === undefined || percent === null) return

  if (percent >= 85) return "danger"

  if (percent >= 60) return "warning"

  return "success"
}

/** A part's share of a whole as a bar length, or nothing when there is no whole to measure against. */
export function statShare(part: number | undefined, whole: number | null | undefined) {
  if (part === undefined || !whole) return

  return Math.min(Math.max(part / whole, 0), 1)
}
