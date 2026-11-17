export * as ConfigExperimental from "./experimental.js"

import { Record, Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigFlag } from "./flag.js"
import { ConfigModel } from "./model.js"
import { ConfigPolicy } from "./policy.js"

// Fork feature: a decision model answers small questions about each prompt before the session model runs.
export interface Decisions extends Schema.Schema.Type<typeof Decisions> {}
export const Decisions = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Set to false to switch the decision layer off while keeping its settings. Defaults to true.",
  }),
  // A plain string, not a model selection: the client codegen cannot carry a selection's branded IDs in a payload.
  model: Schema.String.pipe(optional).annotate({
    description:
      "The decision model that answers, as providerID/modelID. Any connected model of type decision works. Defaults to openrouter/~typesafe/jev-latest.",
  }),
  models: Schema.Record(Schema.String, Schema.String).pipe(optional).annotate({
    description:
      "Models a prompt may be routed between, as providerID/modelID, each with a sentence saying what it is best for. A session is rerouted only while its own model is one of these, and only within that model's provider.",
  }),
  plan: Schema.Boolean.pipe(optional).annotate({
    description:
      "Ask whether a prompt is a large task, and have the assistant reply with a short plan and wait before starting one. Defaults to true.",
  }),
  confidence: Schema.Finite.pipe(optional).annotate({
    description: "How sure the decision model must be, from 0 to 1, before its answer is acted on. Defaults to 0.7.",
  }),
}).annotate({ identifier: "ConfigExperimental.Decisions" })

// Fork feature: where the weather tool gets its forecast.
export const WeatherSource = Schema.Struct({
  type: Schema.Literals(["met-norway", "open-meteo", "wttr"]).annotate({
    description: "The service: MET Norway, Open-Meteo or wttr.in. All are free and need no key.",
  }),
  name: Schema.String.pipe(optional).annotate({ description: "A label for this source in Settings." }),
  url: Schema.String.pipe(optional).annotate({
    description: "The service's base URL, to use a mirror or a self-hosted copy instead of the public one.",
  }),
  disabled: Schema.Boolean.pipe(optional).annotate({ description: "Keep the source listed but do not use it." }),
}).annotate({ identifier: "ConfigExperimental.WeatherSource" })
export type WeatherSource = typeof WeatherSource.Type

export const Weather = Schema.Struct({
  sources: Schema.Array(WeatherSource).annotate({
    description: "The sources the weather tool tries, in order; the first that answers is used.",
  }),
}).annotate({ identifier: "ConfigExperimental.Weather" })
export type Weather = typeof Weather.Type

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: the built-in shell permission scanner is now always enabled.",
  }),
  codemode_vm: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: ignored because Code Mode always runs on the VM.",
  }),
  all_flags: Schema.Boolean.pipe(optional).annotate({
    description:
      "Turn every feature flag on regardless of the build channel, like OPENCODE_FLAGS=all; explicit per-flag settings still win, and false is not a kill switch.",
  }),
  ...Record.map(ConfigFlag.registry, (description) =>
    Schema.Boolean.pipe(optional).annotate({
      description: `${description} Defaults to on in local and dev builds and off in releases.`,
    }),
  ),
  part_rows: Schema.Boolean.pipe(optional).annotate({
    description:
      "Write each assistant part as its own session_part row instead of rewriting the whole message on every event. Defaults to false.",
  }),
  image_generate: Schema.Union([
    Schema.Boolean,
    Schema.Struct({
      model: ConfigModel.Selection.pipe(optional).annotate({
        description:
          "Default model for the experimental_image_generate tool when the agent doesn't choose one, as providerID/modelID. Falls back to automatic selection when it isn't available.",
      }),
    }),
  ])
    .pipe(optional)
    .annotate({
      description:
        "Settings for the experimental_image_generate tool, which is offered while a connected provider has an image model.",
    }),
  visuals: Schema.Boolean.pipe(optional).annotate({
    description:
      "Tell models they may answer with inline visuals (charts, weather cards), which the desktop app draws. Set to false for clients that show text only. Defaults to true.",
  }),
  weather: Weather.pipe(optional).annotate({
    description:
      "Sources for the weather tool. Without this it uses MET Norway, then Open-Meteo. An empty list turns the tool's lookups off.",
  }),
  decisions: Decisions.pipe(optional).annotate({
    description:
      "Experimental: route each prompt with a decision model. When the decision model cannot be reached or paid for, the prompt runs unrouted and the session says so.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  location_idle_timeout: Schema.Union([Schema.DurationFromString, Schema.Literal(false)])
    .pipe(optional)
    .annotate({
      description:
        'How long a location can go without session activity before its services are unloaded. Running sessions and background jobs keep a location loaded. Set to false to never unload (default: "60 minutes")',
    }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
