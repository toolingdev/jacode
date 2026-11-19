import { Config } from "@opencode/schema/config"
import { ConfigCustomProvider } from "@opencode/schema/config/custom-provider"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigShell } from "@opencode/schema/config/shell"
import { Mcp } from "@opencode/schema/mcp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ConfigGroup = HttpApiGroup.make("server.config")
  .add(
    HttpApiEndpoint.get("config.get", "/api/config", {
      query: LocationQuery,
      success: Schema.Array(Config.Entry),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "config.get",
          summary: "Get configuration",
          description:
            "Return configuration documents and discovery sources for the requested location, from lowest to highest priority.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("config.shells", "/api/config/shell", {
      success: Schema.Array(ConfigShell.Option),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "config.shells",
        summary: "List available shells",
        description: "Return shells available to terminal and agent execution.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("config.update", "/api/experimental/config", {
      payload: Config.Patch,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.update",
        summary: "Update global configuration",
        description: "Patch supported fields in the highest-precedence global configuration document.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("config.mcp.set", "/api/experimental/config/mcp/:server", {
      params: { server: Schema.String },
      // Wrapped in a struct because the client codegen cannot represent a top-level union payload.
      payload: Schema.Struct({ config: Mcp.ServerConfig }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.mcp.set",
        summary: "Save MCP server",
        description:
          "Experimental: may change without compatibility guarantees. Add an MCP server to the highest-precedence global configuration document, or replace the one of that name there, so it stays configured across restarts.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("config.mcp.remove", "/api/experimental/config/mcp/:server", {
      params: { server: Schema.String },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.mcp.remove",
        summary: "Delete saved MCP server",
        description:
          "Experimental: may change without compatibility guarantees. Remove an MCP server from the highest-precedence global configuration document. A server another document defines stays configured.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("config.provider.set", "/api/experimental/config/provider/:provider", {
      params: { provider: Schema.String },
      payload: ConfigCustomProvider.Info,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.provider.set",
        summary: "Save provider",
        description:
          "Experimental: may change without compatibility guarantees. Add an OpenAI-compatible provider to the highest-precedence global configuration document, or replace the one of that ID there, so it stays configured across restarts. Its API key is stored separately, as the credential of the integration with the same ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("config.provider.remove", "/api/experimental/config/provider/:provider", {
      params: { provider: Schema.String },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.provider.remove",
        summary: "Delete saved provider",
        description:
          "Experimental: may change without compatibility guarantees. Remove a provider from the highest-precedence global configuration document. A provider another document defines stays configured.",
      }),
    ),
  )
  // Fork feature: the app saves these settings itself, so nobody has to edit the config file by hand.
  .add(
    HttpApiEndpoint.put("config.decisions.set", "/api/experimental/config/decisions", {
      payload: ConfigExperimental.Decisions,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.decisions.set",
        summary: "Save decision layer settings",
        description:
          "Experimental: may change without compatibility guarantees. Set the decision layer's settings in the highest-precedence global configuration document, replacing the ones there.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("config.decisions.remove", "/api/experimental/config/decisions", {
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.decisions.remove",
        summary: "Turn the decision layer off",
        description:
          "Experimental: may change without compatibility guarantees. Remove the decision layer's settings from the highest-precedence global configuration document. Settings another document defines stay configured.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("config.weather.set", "/api/experimental/config/weather", {
      payload: ConfigExperimental.Weather,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.weather.set",
        summary: "Save weather sources",
        description:
          "Experimental: may change without compatibility guarantees. Set the weather tool's sources in the highest-precedence global configuration file.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("config.weather.remove", "/api/experimental/config/weather", {
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.weather.remove",
        summary: "Reset weather sources",
        description:
          "Experimental: may change without compatibility guarantees. Remove the weather tool's sources from the highest-precedence global configuration file, which returns it to its default sources.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("config.time.set", "/api/experimental/config/time", {
      payload: ConfigExperimental.Time,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.time.set",
        summary: "Save time servers",
        description:
          "Experimental: may change without compatibility guarantees. Set the time tool's NTP servers in the highest-precedence global configuration file.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("config.time.remove", "/api/experimental/config/time", {
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.time.remove",
        summary: "Reset time servers",
        description:
          "Experimental: may change without compatibility guarantees. Remove the time tool's NTP servers from the highest-precedence global configuration file, which returns it to its default servers.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("config.plugin.add", "/api/experimental/config/plugin/add", {
      payload: Schema.Struct({ package: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.plugin.add",
        summary: "Add plugin",
        description:
          "Experimental: may change without compatibility guarantees. List a plugin, as an npm or git package spec or a local path, in the highest-precedence global configuration document. The plugin is installed and loaded when configuration reloads; one already listed there is left as it is.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("config.plugin.remove", "/api/experimental/config/plugin/remove", {
      payload: Schema.Struct({ package: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.plugin.remove",
        summary: "Remove plugin",
        description:
          "Experimental: may change without compatibility guarantees. Remove a plugin from the highest-precedence global configuration document. A plugin another document lists stays configured.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("config.skill.add", "/api/experimental/config/skill/add", {
      payload: Schema.Struct({ source: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.skill.add",
        summary: "Add skill source",
        description:
          "Experimental: may change without compatibility guarantees. List a folder path or a skill index URL to discover skills from in the highest-precedence global configuration document. One already listed there is left as it is.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("config.skill.remove", "/api/experimental/config/skill/remove", {
      payload: Schema.Struct({ source: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.skill.remove",
        summary: "Remove skill source",
        description:
          "Experimental: may change without compatibility guarantees. Remove a skill source from the highest-precedence global configuration document. A source another document lists stays configured.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "config", description: "Location-scoped configuration routes." }))
