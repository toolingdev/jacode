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
 * the machine could not be reached or asked for a password, ssh is not installed, or this app carries no server
 * for the machine's processor.
 */
export const WorkerReport = Schema.Struct({
  passed: Schema.Boolean,
  checks: Schema.Array(WorkerCheck),
  /** The last lines the machine printed, for the details view. */
  output: Schema.String,
  failure: Schema.optional(Schema.Literals(["input", "connection", "ssh-missing", "binary"])),
})

export type WorkerReport = typeof WorkerReport.Type

export const WorkerRequest = Schema.Struct({
  /** Where the machine is, as ssh takes it: `user@host`, or a full ssh command. */
  target: Schema.String,
  /** Whether the worker gets a real browser on a virtual screen; `auto` leaves it to the machine's size. */
  browser: Schema.Literals(["auto", "yes", "no"]),
})

export type WorkerRequest = typeof WorkerRequest.Type

/** Fork feature: setting a remote machine up as a worker, run by the main process over ssh. */
export const Workers = Ipc.define({
  id: "workers",
  methods: {
    /** Looks at the machine and changes nothing. */
    check: { input: WorkerRequest, output: WorkerReport },
    /** Checks again, then installs or updates the worker. */
    install: { input: WorkerRequest, output: WorkerReport },
  },
})
