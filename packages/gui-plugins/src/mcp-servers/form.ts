import type { ExperimentalConfigMcpSetInput } from "@opencode/client/promise"

/** The Add server form as the user typed it. */
export type McpForm = {
  readonly name: string
  readonly type: "local" | "remote"
  readonly command: string
  readonly environment: string
  readonly url: string
  readonly headers: string
}

/** What is wrong with one field, as an i18n key suffix under `error.`. */
export type McpFormErrors = {
  readonly name?: "name.required" | "name.invalid" | "name.taken" | undefined
  readonly command?: "command.required" | "command.quote" | undefined
  readonly environment?: "environment.invalid" | undefined
  readonly url?: "url.invalid" | undefined
  readonly headers?: "headers.invalid" | undefined
}

export type McpConfig = ExperimentalConfigMcpSetInput["config"]

export type McpFormResult =
  | { readonly ok: true; readonly name: string; readonly config: McpConfig }
  | { readonly ok: false; readonly errors: McpFormErrors }

export const emptyMcpForm: McpForm = { name: "", type: "local", command: "", environment: "", url: "", headers: "" }

/**
 * The server config a filled form describes, or what to fix. Only the fields of the chosen type are read. Values are
 * kept as typed, so `{env:NAME}` reaches the config file for the server to substitute.
 */
export function readMcpForm(form: McpForm, taken: readonly string[], original?: McpConfig): McpFormResult {
  const name = form.name.trim()

  const nameError = !name
    ? "name.required"
    : !/^[A-Za-z0-9_-]+$/.test(name)
      ? "name.invalid"
      : taken.includes(name)
        ? "name.taken"
        : undefined

  if (form.type === "remote") {
    const url = form.url.trim()
    const headers = pairs(form.headers, ":")
    const valid = URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)

    if (nameError || !valid || !headers)
      return {
        ok: false,
        errors: {
          name: nameError,
          url: valid ? undefined : "url.invalid",
          headers: headers ? undefined : "headers.invalid",
        },
      }

    // An edit keeps what the form has no field for, such as timeouts; a cleared headers box removes the headers.
    const { headers: _, ...kept } = original?.type === "remote" ? original : { type: "remote" as const, url }

    return {
      ok: true,
      name,
      config: Object.keys(headers).length > 0 ? { ...kept, url, headers } : { ...kept, url },
    }
  }

  const command = splitCommand(form.command)
  const environment = pairs(form.environment, "=")
  const commandError = !command ? "command.quote" : command.length === 0 ? "command.required" : undefined

  if (nameError || !command || commandError || !environment)
    return {
      ok: false,
      errors: {
        name: nameError,
        command: commandError,
        environment: environment ? undefined : "environment.invalid",
      },
    }

  const { environment: _, ...kept } = original?.type === "local" ? original : { type: "local" as const, command }

  return {
    ok: true,
    name,
    config: Object.keys(environment).length > 0 ? { ...kept, command, environment } : { ...kept, command },
  }
}

/** A saved server as the form shows it for editing. An argument that holds spaces is quoted, so it reads back whole. */
export function mcpFormOf(name: string, config: McpConfig): McpForm {
  if (config.type === "remote")
    return {
      ...emptyMcpForm,
      name,
      type: "remote",
      url: config.url,
      headers: Object.entries(config.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    }

  return {
    ...emptyMcpForm,
    name,
    command: config.command
      .map((part) => (/^[^\s"']+$/.test(part) ? part : part.includes('"') ? `'${part}'` : `"${part}"`))
      .join(" "),
    environment: Object.entries(config.environment ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  }
}

/**
 * A command line as its arguments: split on spaces, with single or double quotes grouping an argument that holds
 * spaces. Undefined when a quote is left open. No escapes or expansion; the server starts the command without a shell.
 */
export function splitCommand(line: string): string[] | undefined {
  const tokens = [...line.matchAll(/"([^"]*)"|'([^']*)'|(["'])|([^\s"']+)|(\s+)/g)]

  if (tokens.some((token) => token[3] !== undefined)) return undefined

  // Adjacent pieces such as `--flag="two words"` are one argument; whitespace ends it.
  return tokens
    .reduce<{ readonly parts: readonly string[]; readonly open: boolean }>(
      (state, token) => {
        if (token[5] !== undefined) return { parts: state.parts, open: false }
        const piece = token[1] ?? token[2] ?? token[4] ?? ""

        return state.open
          ? { parts: [...state.parts.slice(0, -1), `${state.parts.at(-1) ?? ""}${piece}`], open: true }
          : { parts: [...state.parts, piece], open: true }
      },
      { parts: [], open: false },
    )
    .parts.slice()
}

// Non-empty lines as name/value pairs split at the first separator; undefined when a line has no name or separator.
function pairs(text: string, separator: string): Record<string, string> | undefined {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const index = line.indexOf(separator)

      return index > 0 ? ([line.slice(0, index).trim(), line.slice(index + 1).trim()] as const) : undefined
    })

  if (entries.some((entry) => entry === undefined)) return undefined

  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}
