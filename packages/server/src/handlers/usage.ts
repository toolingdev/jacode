import { UsageLimits } from "@opencode/core/usage-limits"
import { UsageSubscription } from "@opencode/core/usage-subscription"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const UsageHandler = HttpApiBuilder.group(Api, "server.usage", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "usage.limits",
        Effect.fn("server.usage.limits")(function* () {
          const limits = yield* UsageLimits.Service
          return yield* response(
            limits.get().pipe(
              Effect.map((info) => info ?? null),
              Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "opencode" })),
            ),
          )
        }),
      )
      .handle(
        "usage.subscriptions",
        Effect.fn("server.usage.subscriptions")(function* () {
          const subscriptions = yield* UsageSubscription.Service
          return yield* response(
            subscriptions
              .list()
              .pipe(
                Effect.mapError(
                  (error) => new ServiceUnavailableError({ message: error.message, service: error.service }),
                ),
              ),
          )
        }),
      )
      .handle(
        "usage.history",
        Effect.fn("server.usage.history")(function* () {
          const subscriptions = yield* UsageSubscription.Service
          return yield* response(
            subscriptions
              .history()
              .pipe(
                Effect.mapError(
                  (error) => new ServiceUnavailableError({ message: error.message, service: error.service }),
                ),
              ),
          )
        }),
      )
  }),
)
