import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

/** One line of the machine check: what was looked at and what was found. */
export const WorkerCheck = Schema.Struct({
  status: Schema.Literals(["ok", "note", "fail"]),
  name: Schema.String,
  detail: Schema.String,
})

export type WorkerCheck = typeof WorkerCheck.Type

/**
 * What a check or an install came to. `failure` says why it could not run at all: the address was not understood,
 * the machine could not be reached or asked for a password, ssh is not installed, this app carries no server for
 * the machine's processor, Docker is not installed or not running, or a Docker step failed.
 */
export const WorkerReport = Schema.Struct({
  passed: Schema.Boolean,
  checks: Schema.Array(WorkerCheck),
  /** The last lines the machine printed, for the details view. */
  output: Schema.String,
  failure: Schema.optional(
    Schema.Literals(["input", "connection", "ssh-missing", "binary", "docker-missing", "docker-stopped", "docker"]),
  ),
})

export type WorkerReport = typeof WorkerReport.Type

export const WorkerRequest = Schema.Struct({
  /** Where the machine is, as ssh takes it: `user@host`, or a full ssh command. */
  target: Schema.String,
  /** Whether the worker gets a real browser on a virtual screen; `auto` leaves it to the machine's size. */
  browser: Schema.Literals(["auto", "yes", "no"]),
})

export type WorkerRequest = typeof WorkerRequest.Type

/** The worker that runs in Docker on this computer; there is at most one. */
export const DockerWorker = Schema.Struct({
  name: Schema.String,
  state: Schema.Literals(["stopped", "starting", "ready", "failed"]),
  /** Where it answers, while it is `ready`. */
  http: Schema.optional(Schema.Struct({ url: Schema.String, password: Schema.String })),
})

export type DockerWorker = typeof DockerWorker.Type

/** A worker JaCode keeps at the app's version, reached over ssh. */
export const UpdateTarget = Schema.Struct({ id: Schema.String, name: Schema.String, target: Schema.String })

export type UpdateTarget = typeof UpdateTarget.Type

/**
 * Where a worker's update stands. `busy` waits for it to be idle and `offline` for it to come back; both are tried
 * again on their own. `rolled-back` means the new version did not start and the previous one runs again; `unmanaged`
 * a worker JaCode did not set up, which it cannot update.
 */
export const WorkerUpdate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  state: Schema.Literals([
    "checking",
    "current",
    "busy",
    "offline",
    "downloading",
    "updating",
    "updated",
    "rolled-back",
    "unmanaged",
    "failed",
  ]),
  /** The version the worker runs, when known. */
  version: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})

export type WorkerUpdate = typeof WorkerUpdate.Type

export const WorkersState = Schema.Struct({
  docker: Schema.NullOr(DockerWorker),
  /** The workers kept at the app's version, and where each one's update stands. */
  updates: Schema.Array(WorkerUpdate),
  /** Whether workers are updated without asking. */
  auto: Schema.Boolean,
  /** The app's own version, which every worker follows. */
  version: Schema.String,
})

export type WorkersState = typeof WorkersState.Type

/** Fork feature: setting a machine up as a worker, run by the main process over ssh or with Docker. */
export const Workers = Ipc.define({
  id: "workers",
  state: WorkersState,
  methods: {
    /** Looks at the machine and changes nothing. */
    check: { input: WorkerRequest, output: WorkerReport },
    /** Checks again, then installs or updates the worker. */
    install: { input: WorkerRequest, output: WorkerReport },
    /** Builds and starts the Docker worker on this computer, or starts the one that is there. */
    dockerStart: { input: Schema.Struct({ name: Schema.String }), output: WorkerReport },
    /** Where the Docker worker answers, starting it first when it is stopped; null when there is none. */
    dockerResolve: {
      input: Schema.Struct({}),
      output: Schema.NullOr(Schema.Struct({ url: Schema.String, password: Schema.String })),
    },
    /**
     * The values this computer's environment gives the named variables, for API keys its config reads from there.
     * A variable that is not set is left out.
     */
    environment: {
      input: Schema.Struct({ names: Schema.Array(Schema.String) }),
      output: Schema.Record(Schema.String, Schema.String),
    },
    /** Stops and removes the Docker worker. Its work stays in its Docker volume. */
    dockerRemove: { input: Schema.Struct({}) },
    /** The workers to keep at the app's version; the list replaces the one before. */
    track: { input: Schema.Struct({ workers: Schema.Array(UpdateTarget) }) },
    /** Updates one worker now, even with automatic updates off. */
    updateNow: { input: Schema.Struct({ id: Schema.String }) },
    /** Turns automatic worker updates on or off. */
    setAuto: { input: Schema.Struct({ auto: Schema.Boolean }) },
  },
})
