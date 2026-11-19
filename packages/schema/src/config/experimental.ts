export * as ConfigExperimental from "./experimental.js"

import { Record, Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigFlag } from "./flag.js"
import { ConfigModel } from "./model.js"
import { ConfigPolicy } from "./policy.js"

// Fork feature: the model Auto uses for each kind of task, when it should not pick one itself.
export const AutoTiers = Schema.Struct({
  quick: Schema.String.pipe(optional).annotate({
    description: "The model for quick, simple requests, as providerID/modelID.",
  }),
  everyday: Schema.String.pipe(optional).annotate({
    description: "The model for everyday work of moderate difficulty, as providerID/modelID.",
  }),
  hard: Schema.String.pipe(optional).annotate({
    description: "The model for hard or multi-step work, as providerID/modelID.",
  }),
  image: Schema.String.pipe(optional).annotate({
    description: "The model for prompts with images, as providerID/modelID. It must read images.",
  }),
}).annotate({ identifier: "ConfigExperimental.AutoTiers" })
export type AutoTiers = typeof AutoTiers.Type

// Fork feature: Auto. A decision model reads each prompt of an Auto chat and says what kind of task it is; Auto then
// answers it with the model set for that kind of task, or one it picks from the models it may use.
export interface Decisions extends Schema.Schema.Type<typeof Decisions> {}
export const Decisions = Schema.Struct({
  // A plain string, not a model selection: the client codegen cannot carry a selection's branded IDs in a payload.
  model: Schema.String.pipe(optional).annotate({
    description:
      "The decision model that reads each prompt, as providerID/modelID. Any connected model of type decision works. Defaults to Jev, else the first decision model connected.",
  }),
  tiers: Schema.Record(Schema.String, AutoTiers).pipe(optional).annotate({
    description:
      'The model Auto uses for each kind of task, by scope: "all" for Auto on every provider, or a provider ID for Auto on that provider. A kind of task left out is picked automatically from the models Auto may use.',
  }),
  allowPaid: Schema.Boolean.pipe(optional).annotate({
    description:
      "Let Auto pick models a provider's subscription does not cover, which are paid per use. Defaults to false: with a subscription, Auto keeps to the models it covers.",
  }),
  plan: Schema.Boolean.pipe(optional).annotate({
    description:
      "Ask whether a prompt is a large task, and have the assistant reply with a short plan and wait before starting one. Applies to every chat. Defaults to false.",
  }),
  confidence: Schema.Finite.pipe(optional).annotate({
    description: "How sure the decision model must be, from 0 to 1, before its answer is acted on. Defaults to 0.7.",
  }),
  enabled: Schema.Boolean.pipe(optional).annotate({ description: "Deprecated: ignored. Auto is chosen per chat." }),
  models: Schema.Record(Schema.String, Schema.String).pipe(optional).annotate({
    description: "Deprecated: ignored. Use tiers.",
  }),
  keep: Schema.Record(Schema.String, Schema.String).pipe(optional).annotate({ description: "Deprecated: ignored." }),
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
  sources: Schema.Array(WeatherSource).pipe(optional).annotate({
    description: "The sources the weather tool tries, in order; the first that answers is used. Defaults to MET Norway, then Open-Meteo.",
  }),
  units: Schema.Literals(["fahrenheit", "celsius"]).pipe(optional).annotate({
    description: "The temperature unit forecasts are given in. Defaults to the one this computer's region uses.",
  }),
}).annotate({ identifier: "ConfigExperimental.Weather" })
export type Weather = typeof Weather.Type

// Fork feature: the NTP servers the time tool asks for the exact time.
export const Time = Schema.Struct({
  servers: Schema.Array(Schema.String).annotate({
    description: "NTP servers, by host name or address, tried in order; the first that answers gives the time.",
  }),
}).annotate({ identifier: "ConfigExperimental.Time" })
export type Time = typeof Time.Type

// Fork feature: the workers this computer's chats may hand scheduled tasks to. The app keeps the list in step with the
// workers it is connected to, so a task can run there while this computer sleeps.
export const Worker = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  password: Schema.String.pipe(optional),
}).annotate({ identifier: "ConfigExperimental.Worker" })
export type Worker = typeof Worker.Type

export const Workers = Schema.Struct({
  list: Schema.Array(Worker).annotate({ description: "Workers by name, with the address their server answers on." }),
}).annotate({ identifier: "ConfigExperimental.Workers" })
export type Workers = typeof Workers.Type

// Fork feature: add-ons that come with the app, off until switched on in Settings › Add-ons.
export const BibleAddon = Schema.Struct({
  enabled: Schema.Boolean.annotate({ description: "Offer the verse tool, which quotes Bible passages exactly." }),
  spanish: Schema.Boolean.pipe(optional).annotate({
    description: "Also give each passage in Spanish (Reina-Valera 1909), and outlines a second-language line. Defaults to false.",
  }),
}).annotate({ identifier: "ConfigExperimental.BibleAddon" })

export const Addons = Schema.Struct({
  bible: BibleAddon.pipe(optional).annotate({
    description: "Bible passages: exact quotes from public-domain translations, and sermon and study outlines.",
  }),
}).annotate({ identifier: "ConfigExperimental.Addons" })
export type Addons = typeof Addons.Type

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
  time: Time.pipe(optional).annotate({
    description:
      "NTP servers for the time tool. Without this it asks time.cloudflare.com, then time.google.com, then pool.ntp.org.",
  }),
  addons: Addons.pipe(optional).annotate({
    description: "Add-ons that come with the app, switched on here. Without this, none is on.",
  }),
  workers: Workers.pipe(optional).annotate({
    description:
      "Workers this computer's chats may schedule tasks on, kept in step by the desktop app. Without this there are none.",
  }),
  decisions: Decisions.pipe(optional).annotate({
    description:
      "Experimental: how Auto picks a model for each prompt, and whether large tasks are planned first. When the decision model cannot be reached or paid for, Auto picks without it and the chat says so.",
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
