/**
 * Fork feature: connected tools switched off for one chat. A switched-off server is a deny rule in the chat's own
 * permissions, which the server applies on every step: the server's tools leave the model's tool list, code mode
 * catalog and MCP instructions, and a call to one is refused. The rule matches the server's tool names, which are its
 * name with characters outside letters, digits, `_` and `-` (and dots) turned into `_`, then `_`, then the tool.
 */

type Rule = { readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }

/** The deny rule that switches a server's tools off in a chat. */
export function offRule(server: string): Rule {
  return { action: `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_*`, resource: "*", effect: "deny" }
}

/** Whether a chat's rules switch a server's tools off. */
export function isOff(rules: readonly Rule[] | undefined, server: string) {
  const rule = offRule(server)

  return (rules ?? []).some((item) => item.action === rule.action && item.resource === "*" && item.effect === "deny")
}

/** A chat's rules with a server switched on or off, keeping every other rule as it was. */
export function withServer(rules: readonly Rule[] | undefined, server: string, on: boolean): Rule[] {
  const rule = offRule(server)
  const rest = (rules ?? []).filter(
    (item) => !(item.action === rule.action && item.resource === "*" && item.effect === "deny"),
  )

  return on ? rest : [...rest, rule]
}
