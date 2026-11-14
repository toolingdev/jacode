import { expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Provider } from "@opencode/core/provider"
import { UsageSubscription } from "@opencode/core/usage-subscription"
import { Money } from "@opencode/schema/money"
import { Effect, Exit, Layer } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const unused = () => Effect.die("unused")

const provider = (id: string, settings: Provider.Settings, activation: Provider.Info["activation"] = "auto") =>
  ({
    ...Provider.Info.empty(Provider.ID.make(id)),
    name: `Name of ${id}`,
    activation,
    settings,
  }) satisfies Provider.Info

const usage = {
  active: true,
  limits: { weeklyInputTokens: 60_000_000, dailyInputTokens: null, dailyImages: 100 },
  dailyImages: { used: 3, remaining: 97, percentUsed: 0.03, resetAt: 1794700800000 },
  dailyInputTokens: null,
  weeklyInputTokens: { used: 26_128_063, remaining: 33_871_937, percentUsed: 0.4354, resetAt: 1794787200000 },
  state: "active",
}

/** Asks UsageSubscription for a location with `providers` loaded, whose stored integration key is `stored`. */
const ask = <A>(
  run: (subscriptions: UsageSubscription.Interface) => Effect.Effect<A, UsageSubscription.UnavailableError>,
  providers: readonly Provider.Info[],
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
  stored?: string,
) =>
  Effect.flatMap(UsageSubscription.Service, run).pipe(
    Effect.provide(
      UsageSubscription.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, { all: () => Effect.succeed(providers) }),
            Layer.mock(Integration.Service, {
              revision: () => 0,
              get: unused,
              connection: {
                active: () =>
                  Effect.succeed(
                    stored === undefined
                      ? undefined
                      : {
                          type: "credential" as const,
                          id: Credential.ID.make("nanogpt"),
                          label: "NanoGPT",
                          method: "key" as const,
                        },
                  ),
                resolve: () =>
                  Effect.succeed(stored === undefined ? undefined : Credential.Key.make({ type: "key", key: stored })),
                key: unused,
                external: unused,
                activate: unused,
                update: unused,
                remove: unused,
                status: unused,
              },
              oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
              command: { connect: unused, status: unused, cancel: unused },
            }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
                Effect.sync(() => {
                  requests.push(request)
                  return HttpClientResponse.fromWeb(request, respond(request.url))
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )

const list = (
  providers: readonly Provider.Info[],
  respond: (url: string) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
  stored?: string,
) => ask((subscriptions) => subscriptions.list(), providers, respond, requests, stored)

it.effect("reads a NanoGPT subscription's allowances with the key the provider is configured with", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const subscriptions = yield* list(
      [
        provider("nanogpt-sub", { baseURL: "https://nano-gpt.com/api/subscription/v1", apiKey: "sub-key" }),
        provider("openrouter", { baseURL: "https://openrouter.ai/api/v1", apiKey: "other-key" }),
      ],
      () => Response.json(usage),
      requests,
    )

    expect(subscriptions).toEqual([
      {
        providerID: Provider.ID.make("nanogpt-sub"),
        name: "Name of nanogpt-sub",
        active: true,
        meters: [
          { unit: "input_tokens", window: "weekly", used: 26_128_063, limit: 60_000_000, resetsAt: 1794787200000 },
          { unit: "images", window: "daily", used: 3, limit: 100, resetsAt: 1794700800000 },
        ],
      },
    ])
    expect(requests.map((request) => [request.url, request.headers.authorization])).toEqual([
      ["https://nano-gpt.com/api/subscription/v1/usage", "Bearer sub-key"],
    ])
  }),
)

it.effect("asks NanoGPT's own origin whatever path the provider's baseURL has", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    yield* list(
      [provider("nanogpt", { baseURL: "https://nano-gpt.com/api/v1", apiKey: "key" })],
      () => Response.json(usage),
      requests,
    )

    expect(requests.map((request) => request.url)).toEqual(["https://nano-gpt.com/api/subscription/v1/usage"])
  }),
)

it.effect("falls back to the key stored for the provider's integration", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    yield* list(
      [provider("nanogpt-sub", { baseURL: "https://nano-gpt.com/api/subscription/v1" })],
      () => Response.json(usage),
      requests,
      "stored-key",
    )

    expect(requests.map((request) => request.headers.authorization)).toEqual(["Bearer stored-key"])
  }),
)

it.effect("lists nothing and sends no key without a NanoGPT provider, a key, or an enabled provider", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const subscriptions = yield* list(
      [
        provider("lookalike", { baseURL: "https://nano-gpt.com.example.org/v1", apiKey: "key" }),
        provider("keyless", { baseURL: "https://nano-gpt.com/api/subscription/v1", apiKey: "" }),
        provider("off", { baseURL: "https://nano-gpt.com/api/subscription/v1", apiKey: "key" }, "disabled"),
        provider("unset", {}),
      ],
      () => Response.json(usage),
      requests,
    )

    expect(subscriptions).toEqual([])
    expect(requests).toEqual([])
  }),
)

it.effect("reports usage NanoGPT refuses as unavailable", () =>
  Effect.gen(function* () {
    const exit = yield* list(
      [provider("nanogpt-sub", { baseURL: "https://nano-gpt.com/api/subscription/v1", apiKey: "bad" })],
      () => new Response("unauthorized", { status: 401 }),
    ).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toContain("UsageSubscription.UnavailableError")
  }),
)

it.effect("reads what the provider's key used by model over the last 30 UTC days", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-14T15:22:35.000Z"))
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const histories = yield* ask(
      (subscriptions) => subscriptions.history(),
      [provider("nanogpt-sub", { baseURL: "https://nano-gpt.com/api/subscription/v1", apiKey: "sub-key" })],
      () =>
        Response.json({
          scope: "current_key",
          from: "2026-10-16",
          to: "2026-11-14",
          totals: { requests: 2 },
          byModel: [
            {
              model: "DeepSeek V4 Pro",
              requests: 1,
              costUsd: 0.5,
              refundedUsd: 0.25,
              netCostUsd: 0.25,
              inputTokens: 61_574,
              outputTokens: 89,
              cacheCreationInputTokens: null,
              totalTokens: 61_663,
            },
          ],
        }),
      requests,
    )

    expect(histories).toEqual([
      {
        providerID: Provider.ID.make("nanogpt-sub"),
        name: "Name of nanogpt-sub",
        from: "2026-10-16",
        to: "2026-11-14",
        models: [
          {
            model: "DeepSeek V4 Pro",
            requests: 1,
            tokens: { input: 61_574, output: 89 },
            cost: Money.USD.make(0.25),
          },
        ],
      },
    ])
    expect(requests.map((request) => [request.url, request.headers.authorization])).toEqual([
      ["https://nano-gpt.com/api/v1/usage?from=2026-10-16&to=2026-11-14", "Bearer sub-key"],
    ])
  }),
)
