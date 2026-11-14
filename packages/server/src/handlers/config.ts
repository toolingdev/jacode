import { Config } from "@opencode/core/config"
import { Provider } from "@opencode/core/provider"
import { ShellSelect } from "@opencode/core/shell/select"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"

// The built-in route for an OpenAI-compatible host's `/images/generations`, set per image model.
const OPENAI_COMPATIBLE_IMAGES = "@opencode/ai/providers/openai-compatible/images"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers
    .handle("config.get", () => Config.Service.use((config) => config.entries()))
    .handle(
      "config.update",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.update) return yield* Effect.die(new Error("Config updates are unavailable"))
        return yield* config.update(ctx.payload).pipe(Effect.orDie)
      }),
    )
    .handle(
      "config.mcp.set",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.mcp) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.mcp(ctx.params.server, ctx.payload.config).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.mcp.remove",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.mcp) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.mcp(ctx.params.server, undefined).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.provider.set",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.provider) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config
          .provider(ctx.params.provider, {
            ...(ctx.payload.name === undefined ? {} : { name: ctx.payload.name }),
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: ctx.payload.baseURL },
            models: {
              ...ctx.payload.models,
              ...Object.fromEntries(
                Object.entries(ctx.payload.imageModels ?? {}).map(([id, model]) => [
                  id,
                  {
                    ...model,
                    type: "image",
                    package: OPENAI_COMPATIBLE_IMAGES,
                    ...(ctx.payload.imageBaseURL === undefined
                      ? {}
                      : { settings: { baseURL: ctx.payload.imageBaseURL } }),
                  },
                ]),
              ),
            },
          })
          .pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.provider.remove",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.provider) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.provider(ctx.params.provider, undefined).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.shells",
      Effect.fn(function* () {
        const shell = yield* ShellSelect.Service
        if (!shell.list) return yield* Effect.die(new Error("Shell discovery is unavailable"))
        return yield* shell.list()
      }),
    ),
)
