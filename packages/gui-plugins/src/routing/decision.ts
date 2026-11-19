import type { SessionMessageUser } from "@opencode/client/promise"
import { Option, Schema } from "effect"

/** What the server keeps on a prompt's message once the decision model has answered. */
const Decision = Schema.Struct({
  answers: Schema.Array(Schema.Struct({ name: Schema.String, choice: Schema.String, confidence: Schema.Finite })),
  // Set for a prompt of an Auto chat: the kind of task, the model Auto used for it, and why.
  auto: Schema.optionalKey(
    Schema.Struct({
      tier: Schema.Literals(["quick", "everyday", "hard", "image"]),
      model: Schema.String,
      reason: Schema.Literals(["sure", "unsure", "quota", "image", "only", "skipped"]),
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

/** A model as the pill names it while the catalog loads: the model's own ID without its provider and vendor. */
export function shortModel(key: string) {
  return key.slice(key.lastIndexOf("/") + 1)
}
