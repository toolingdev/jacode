export * as ConfigSecrets from "./secrets.js"

import { isRecord } from "@opencode/util/record"

// Fork feature: a config entry shown in the app never carries a secret written out in full. A value under a key
// that names a secret is shown as HIDDEN unless it is a reference such as `{env:NAME}` or `{file:path}`; saving an
// entry that still holds HIDDEN keeps the value the file had there.

export const HIDDEN = "••••••••"

const SECRET = /key|token|secret|password|authorization/i
const REFERENCE = /^\{(env|file):[^}]+\}$/

/** The entry with every secret written out in full replaced by HIDDEN. */
export function hide(value: unknown, key = ""): unknown {
  if (typeof value === "string") return SECRET.test(key) && !REFERENCE.test(value.trim()) ? HIDDEN : value

  if (Array.isArray(value)) return value.map((item) => hide(item, key))

  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, hide(item, name)]))
}

/** The edited entry with each HIDDEN put back to what the file had in the same place; one the file lacks is dropped. */
export function restore(edited: unknown, previous: unknown): unknown {
  if (edited === HIDDEN) return typeof previous === "string" ? previous : undefined

  if (Array.isArray(edited))
    return edited.map((item, index) => restore(item, Array.isArray(previous) ? previous[index] : undefined))

  if (!isRecord(edited)) return edited

  return Object.fromEntries(
    Object.entries(edited).flatMap(([name, item]) => {
      const value = restore(item, isRecord(previous) ? previous[name] : undefined)

      return value === undefined ? [] : [[name, value]]
    }),
  )
}
