import { Location } from "@opencode/schema/location"
import { UsageLimits } from "@opencode/schema/usage-limits"
import { UsageSubscription } from "@opencode/schema/usage-subscription"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const UsageGroup = HttpApiGroup.make("server.usage")
  .add(
    HttpApiEndpoint.get("usage.limits", "/api/experimental/usage/limits", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(UsageLimits.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.limits",
          summary: "Get usage limits",
          description:
            "Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("usage.subscriptions", "/api/experimental/usage/subscriptions", {
      query: LocationQuery,
      success: Location.response(Schema.Array(UsageSubscription.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.subscriptions",
          summary: "Get subscription usage",
          description:
            "Experimental: may change without compatibility guarantees. Return what the flat-rate subscriptions of the location's loaded providers have used of their allowances; empty when no provider reports one.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("usage.history", "/api/experimental/usage/history", {
      query: LocationQuery,
      success: Location.response(Schema.Array(UsageSubscription.History)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.history",
          summary: "Get usage history",
          description:
            "Experimental: may change without compatibility guarantees. Return what the subscription providers of the location recorded by model over the last 30 days, for the API key each is used with; empty when no provider reports it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("usage.included", "/api/experimental/usage/included", {
      query: LocationQuery,
      success: Location.response(Schema.Array(UsageSubscription.Included)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.included",
          summary: "Get subscription models",
          description:
            "Experimental: may change without compatibility guarantees. Return the models each subscription provider of the location covers; its other models are paid per use. Empty when no provider reports one.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "usage",
      description: "Experimental usage limit routes.",
    }),
  )
