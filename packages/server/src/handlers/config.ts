import { Config } from "@opencode/core/config"
import { Provider } from "@opencode/core/provider"
import { ShellSelect } from "@opencode/core/shell/select"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"

// The built-in route for an OpenAI-compatible host's `/images/generations`, set per image model.
const OPENAI_COMPATIBLE_IMAGES = "@opencode/ai/providers/openai-compatible/images"

function named(model: { readonly name?: string }) {
  return model.name === undefined ? {} : { name: model.name }
}

// Explicit either way: an unset capability defaults to accepting images, which text-only models refuse.
function inputs(model: { readonly images?: boolean }) {
  return model.images ? ["text", "image"] : ["text"]
}

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
              ...Object.fromEntries(
                Object.entries(ctx.payload.models).map(([id, model]) => [
                  id,
                  { ...named(model), capabilities: { input: inputs(model) } },
                ]),
              ),
              ...Object.fromEntries(
                Object.entries(ctx.payload.imageModels ?? {}).map(([id, model]) => [
                  id,
                  {
                    ...named(model),
                    type: "image",
                    package: OPENAI_COMPATIBLE_IMAGES,
                    capabilities: { input: inputs(model), output: ["image"] },
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
      "config.decisions.set",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.decisions) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.decisions(ctx.payload).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.decisions.remove",
      Effect.fn(function* () {
        const config = yield* Config.Service
        if (!config.decisions) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.decisions(undefined).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.weather.set",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.weather) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.weather(ctx.payload).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.weather.remove",
      Effect.fn(function* () {
        const config = yield* Config.Service
        if (!config.weather) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.weather(undefined).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.plugin.add",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.listed) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.listed("plugins", ctx.payload.package.trim(), true).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.plugin.remove",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.listed) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.listed("plugins", ctx.payload.package.trim(), false).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.skill.add",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.listed) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.listed("skills", ctx.payload.source.trim(), true).pipe(Effect.orDie)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "config.skill.remove",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.listed) return yield* Effect.die(new Error("Config updates are unavailable"))
        yield* config.listed("skills", ctx.payload.source.trim(), false).pipe(Effect.orDie)
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
