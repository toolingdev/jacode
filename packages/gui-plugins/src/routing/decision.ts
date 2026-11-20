import type { SessionMessageUser } from "@opencode/client/promise"
import { Option, Schema } from "effect"

/** What the server keeps on a prompt's message once the decision model has answered. */
const Decision = Schema.Struct({
  answers: Schema.Array(Schema.Struct({ name: Schema.String, choice: Schema.String, confidence: Schema.Finite })),
  // Set for a prompt of an Auto chat: the kind of task, the model Auto used for it, why, and out of how many.
  auto: Schema.optionalKey(
    Schema.Struct({
      tier: Schema.Literals(["quick", "everyday", "hard", "image"]),
      model: Schema.String,
      reason: Schema.Literals(["sure", "band", "set", "unsure", "quota", "only", "skipped"]),
      // How many models the decision model chose between.
      from: Schema.optionalKey(Schema.Finite),
    }),
  ),
})

const decode = Schema.decodeUnknownOption(Decision)

/** What the decision model and Auto decided for a prompt. */
export type RoutingDecision = typeof Decision.Type

/** The decision kept on the latest prompt that was decided on, or nothing when no prompt of the chat was. */
export function lastDecision(
  messages: readonly { readonly type: string; readonly metadata?: SessionMessageUser["metadata"] }[],
): RoutingDecision | undefined {
  return Option.getOrUndefined(
    decode(
      messages.findLast((message) => message.type === "user" && message.metadata?.decisions !== undefined)?.metadata
        ?.decisions,
    ),
  )
}

/**
 * The model that answered the latest decided prompt when it is not the one Auto picked: Auto moved the prompt to
 * another model after the first failed. Undefined while nothing answered yet or the pick answered.
 */
export function switchedTo(
  messages: readonly {
    readonly type: string
    readonly metadata?: SessionMessageUser["metadata"]
    readonly model?: { readonly providerID: string; readonly id: string }
  }[],
  picked: string,
): string | undefined {
  const prompt = messages.findLastIndex((message) => message.type === "user" && message.metadata?.decisions !== undefined)
  const answer = messages.slice(prompt + 1).findLast((message) => message.type === "assistant" && message.model)?.model

  if (prompt === -1 || !answer) return undefined
  const key = `${answer.providerID}/${answer.id}`

  return key === picked ? undefined : key
}

/** A model as the pill names it while the catalog loads: the model's own ID without its provider and vendor. */
export function shortModel(key: string) {
  return key.slice(key.lastIndexOf("/") + 1)
}
