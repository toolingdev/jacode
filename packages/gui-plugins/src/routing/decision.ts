import type { SessionMessageUser } from "@opencode/client/promise"
import { Option, Schema } from "effect"

/** What the server keeps on a prompt's message once the decision model has answered. */
const Decision = Schema.Struct({
  answers: Schema.Array(Schema.Struct({ name: Schema.String, choice: Schema.String, confidence: Schema.Finite })),
})

const decode = Schema.decodeUnknownOption(Decision)

/** One answer of the decision model. */
export type RoutingAnswer = (typeof Decision.Type)["answers"][number]

/** The answers kept on the latest prompt that was decided on, or nothing when no prompt of the chat was. */
export function lastDecision(
  messages: readonly { readonly type: string; readonly metadata?: SessionMessageUser["metadata"] }[],
): readonly RoutingAnswer[] | undefined {
  return Option.getOrUndefined(
    decode(
      messages.findLast((message) => message.type === "user" && message.metadata?.decisions !== undefined)?.metadata
        ?.decisions,
    ),
  )?.answers
}

/** A routed model as the pill names it: the model's own ID without its provider and vendor. */
export function shortModel(key: string) {
  return key.slice(key.lastIndexOf("/") + 1)
}
