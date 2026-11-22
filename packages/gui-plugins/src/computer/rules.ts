/**
 * Fork feature: Mac control switched on for one chat. The computer tool starts denied for every agent; a chat that
 * allows it carries an `ask` rule for the `computer` action, which comes after the agent's rules, so the tool joins
 * that chat's tool list and each action still asks the user.
 */

type Rule = { readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }

const ON: Rule = { action: "computer", resource: "*", effect: "ask" }

const same = (item: Rule) => item.action === ON.action && item.resource === ON.resource && item.effect === ON.effect

/** Whether a chat's rules switch Mac control on. */
export function isOn(rules: readonly Rule[] | undefined) {
  return (rules ?? []).some(same)
}

/** A chat's rules with Mac control switched on or off, keeping every other rule as it was. */
export function withComputer(rules: readonly Rule[] | undefined, on: boolean): Rule[] {
  const rest = (rules ?? []).filter((item) => !same(item))

  return on ? [...rest, ON] : rest
}
