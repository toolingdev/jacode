import { Config } from "@opencode/schema/config"
import { ConfigCustomProvider } from "@opencode/schema/config/custom-provider"
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
  .annotateMerge(OpenApi.annotations({ title: "config", description: "Location-scoped configuration routes." }))
