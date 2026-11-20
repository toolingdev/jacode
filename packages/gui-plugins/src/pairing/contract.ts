import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** Fork feature: a way another device reaches this computer. */
export const AccessMethod = Schema.Literals(["tailscale", "funnel", "opentunnel", "lan", "custom"])

export type AccessMethod = typeof AccessMethod.Type

/** What the background service found for one way in: off, being set up, working at `url`, or failed with `message`. */
export const AccessEntry = Schema.Struct({
  method: AccessMethod,
  state: Schema.Literals(["off", "starting", "ready", "failed"]),
  url: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  /** Whether the user turned this way on, even while the Remote access switch pauses it. */
  chosen: Schema.Boolean,
})

export type AccessEntry = typeof AccessEntry.Type

/** Every way in, in the user's order, as `opencode service get access-status` prints it. */
export const AccessStatus = Schema.Struct({
  enabled: Schema.Boolean,
  paused: Schema.Boolean,
  running: Schema.Boolean,
  entries: Schema.Array(AccessEntry),
  custom: Schema.optional(Schema.String),
})

export type AccessStatus = typeof AccessStatus.Type

/** The ways in to turn on and their order, as `opencode service set access` takes it. */
export const AccessInput = Schema.Struct({
  order: Schema.Array(AccessMethod),
  tailscale: Schema.Boolean,
  funnel: Schema.Boolean,
  lan: Schema.Boolean,
  opentunnel: Schema.Boolean,
  custom: Schema.optional(Schema.String),
})

export type AccessInput = typeof AccessInput.Type

/**
 * Turns on remote access and keeps this machine's display awake while another device uses it. The window asks the
 * local server for its remote address and pairing codes through its own `ServerRef`; remote access, which changes
 * the background service's settings through the CLI, and the display sleep blocker need the main process.
 */
export const Pairing = Ipc.define({
  id: "pairing",
  methods: {
    /** Whether remote access is on: the background service serves an OpenTunnel address. */
    remote: { output: Schema.Boolean },
    /**
     * Turns remote access on or off, then starts the background service again. Turning it on the first time creates
     * the tunnel, which can take a minute.
     */
    setRemote: { input: Schema.Boolean },
    /** Whether main holds the display sleep blocker. */
    screenActive: { output: Schema.Boolean },
    /** Holds or releases the display sleep blocker, and remembers the choice. */
    setScreenActive: { input: Schema.Boolean },
    /** Fork feature: every way in and what the background service found for it. */
    access: { output: AccessStatus },
    /** Fork feature: turns ways in on or off and orders them, then starts the background service again. */
    setAccess: { input: AccessInput },
  },
})
