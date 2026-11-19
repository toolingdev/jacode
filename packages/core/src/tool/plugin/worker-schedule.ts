export * as WorkerScheduleTools from "./worker-schedule.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Schedule } from "@opencode/schema/schedule"
import { Effect, Schema, SchemaGetter } from "effect"
import { Config } from "../../config.js"

// Fork feature: a chat on this computer hands a scheduled task to a worker, so it runs there even while this computer
// sleeps or is off. The task gets its own chat on the worker, which keeps the results; this chat can read them back
// later. Workers are listed in config (`experimental.workers`), which the desktop app keeps in step with the workers
// it is connected to.

const TIMEOUT_MS = 15_000

/** The workers chats may schedule tasks on, from the latest config that lists them. */
export function workers(entries: readonly Entry[]): readonly ConfigExperimental.Worker[] {
  return (
    entries.findLast(
      (entry): entry is Document => entry.type === "document" && entry.info.experimental?.workers !== undefined,
    )?.info.experimental?.workers?.list ?? []
  )
}

/** The worker a call names, by name without regard to case, else the only one there is. */
export function pick(list: readonly ConfigExperimental.Worker[], name: string | undefined) {
  if (name === undefined) return list.length === 1 ? list[0] : undefined

  return list.find((worker) => worker.name.toLowerCase() === name.trim().toLowerCase())
}

/** The text of the newest answer in a worker chat's message list. */
export function latestAnswer(messages: unknown) {
  const list = Schema.decodeUnknownOption(MessageList)(messages)

  if (list._tag === "None") return undefined
  const newest = list.value.data
    .filter((message) => message.type === "assistant")
    .toSorted((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0]
  const text = (newest?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))

  return text.length > 0 ? text.join("\n") : undefined
}

const MessageList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      time: Schema.optionalKey(Schema.Struct({ created: Schema.optionalKey(Schema.Finite) })),
      content: Schema.optionalKey(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
      ),
    }),
  ),
})

const WorkerName = Schema.String.annotate({
  description: "The worker's name, as worker_list gives it. May be left out when there is only one worker.",
})

const ScheduleInput = Schema.Struct({
  worker: Schema.optionalKey(WorkerName),
  title: Schema.optionalKey(
    Schema.String.annotate({ description: "A title for the task's chat on the worker, so the user can find it." }),
  ),
  ...Schedule.Request.fields,
})

const ScheduleOutput = Schema.Struct({
  worker: Schema.String,
  sessionID: Schema.String,
  scheduleID: Schema.String,
  status: Schema.String,
  nextDueAt: Schema.optional(Schema.String),
})

const StatusInput = Schema.Struct({
  worker: Schema.optionalKey(WorkerName),
  sessionID: Schema.String.annotate({ description: "The worker chat's id, as worker_schedule gave it." }),
})

const StatusOutput = Schema.Struct({
  worker: Schema.String,
  sessionID: Schema.String,
  schedules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      runCount: Schema.Finite,
      nextDueAt: Schema.optionalKey(Schema.String),
      lastFiredAt: Schema.optionalKey(Schema.String),
      lastOutcome: Schema.optionalKey(Schema.String),
    }),
  ),
  answer: Schema.NullOr(Schema.String),
})

const ListOutput = Schema.Struct({ workers: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })) })

// The parts of a schedule the worker sends back that these tools report; its times arrive as Unix milliseconds.
const Millis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((ms) => new Date(ms).toISOString()),
    encode: SchemaGetter.transform((iso) => Date.parse(iso)),
  }),
)
const RemoteSchedule = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  runCount: Schema.Finite,
  nextDueAt: Schema.optionalKey(Millis),
  lastFiredAt: Schema.optionalKey(Millis),
  lastOutcome: Schema.optionalKey(Schema.String),
})

export const Plugin = {
  id: "opencode.tool.worker-schedule",
  effect: Effect.fn("WorkerScheduleTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service

    const find = (name: string | undefined) =>
      Effect.gen(function* () {
        const list = workers(yield* config.entries())
        const worker = pick(list, name)

        if (worker) return worker

        if (list.length === 0)
          return yield* Effect.fail(new Error("No workers are connected. Add one in the app under Settings › Workers."))

        return yield* Effect.fail(
          new Error(
            `Name the worker to use: ${list.map((item) => item.name).join(", ")}${name ? ` (no worker is called "${name}")` : ""}.`,
          ),
        )
      })

    // One call to a worker's API; the worker's own error message when it refuses.
    const call = (worker: ConfigExperimental.Worker, method: string, path: string, body?: unknown) =>
      Effect.tryPromise({
        try: async () => {
          const headers = new Headers({ "content-type": "application/json" })

          if (worker.password) headers.set("authorization", `Basic ${btoa(`opencode:${worker.password}`)}`)
          const response = await fetch(new URL(path, worker.url), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          const text = await response.text()
          const json: unknown = text ? JSON.parse(text) : undefined

          if (!response.ok) throw new Error(`${worker.name} answered ${response.status}: ${text.slice(0, 300)}`)

          return json
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(`${worker.name} could not be reached: ${String(error)}`),
      })

    const SessionData = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
    const ScheduleData = Schema.Struct({ data: RemoteSchedule })
    const SchedulesData = Schema.Struct({ data: Schema.Array(RemoteSchedule) })

    const failure = (message: string) => (error: unknown) => new ToolFailure({ message, error })

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "worker_list",
        description:
          "List the workers this computer is connected to: other computers that keep running while this one sleeps or is off.",
        input: Schema.Struct({}),
        output: ListOutput,
        options: { namespace: "opencode", codemode: true, pinned: true },
        execute: () =>
          config.entries().pipe(
            Effect.map((entries) => {
              const list = workers(entries).map((worker) => ({ name: worker.name, url: worker.url }))

              return {
                output: { workers: list },
                content:
                  list.length === 0
                    ? "No workers are connected."
                    : list.map((worker) => `${worker.name} (${worker.url})`).join("\n"),
              }
            }),
          ),
      })

      editor.add({
        name: "worker_schedule",
        description:
          "Schedule a task on a worker instead of this computer, when the user asks for it to run remotely or it must run while this computer may be asleep or off. Takes the same timing as schedule_create. The task gets its own chat on the worker, which wakes with `prompt` and keeps the results; write the prompt so it stands alone, with every detail the worker needs, since it cannot see this chat. Note the returned sessionID: worker_schedule_status reads the results back later.",
        input: ScheduleInput,
        output: ScheduleOutput,
        options: { namespace: "opencode", codemode: true, pinned: true },
        execute: (input) =>
          Effect.gen(function* () {
            const worker = yield* find(input.worker)
            const session = yield* call(worker, "POST", "/api/session", {
              title: input.title ?? input.name ?? "Scheduled task",
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SessionData)),
              Effect.map((value) => value.data),
            )
            const request = { ...input, worker: undefined, title: undefined }
            const schedule = yield* call(worker, "POST", "/api/experimental/schedule", {
              sessionID: session.id,
              ...request,
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ScheduleData)),
              Effect.map((value) => value.data),
              // A chat left with nothing scheduled in it would only confuse the user.
              Effect.tapError(() => call(worker, "DELETE", `/api/session/${session.id}`).pipe(Effect.ignore)),
            )

            const output = {
              worker: worker.name,
              sessionID: session.id,
              scheduleID: schedule.id,
              status: schedule.status,
              nextDueAt: schedule.nextDueAt,
            }

            return {
              output,
              content: `Scheduled on ${worker.name} (chat ${session.id}, schedule ${schedule.id}): ${schedule.status}${schedule.nextDueAt ? `, next run ${schedule.nextDueAt}` : ""}. Results stay in that chat on ${worker.name}; read them with worker_schedule_status.`,
            }
          }).pipe(Effect.mapError(failure("Unable to schedule on the worker"))),
      })

      editor.add({
        name: "worker_schedule_status",
        description:
          "Read back a task scheduled with worker_schedule: whether it has run, when it runs next, and the worker's latest answer in that chat.",
        input: StatusInput,
        output: StatusOutput,
        options: { namespace: "opencode", codemode: true, pinned: true },
        execute: (input) =>
          Effect.gen(function* () {
            const worker = yield* find(input.worker)
            const schedules = yield* call(
              worker,
              "GET",
              `/api/experimental/schedule?sessionID=${encodeURIComponent(input.sessionID)}`,
            ).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SchedulesData)),
              Effect.map((value) => value.data),
            )
            const messages = yield* call(
              worker,
              "GET",
              `/api/session/${encodeURIComponent(input.sessionID)}/message?limit=20`,
            )
            const answer = latestAnswer(messages) ?? null

            const output = { worker: worker.name, sessionID: input.sessionID, schedules, answer }
            const lines = schedules.map(
              (item) =>
                `Schedule ${item.id}: ${item.status}, ran ${item.runCount} time(s)${item.lastOutcome ? `, last ${item.lastOutcome}` : ""}${item.nextDueAt ? `, next ${item.nextDueAt}` : ""}`,
            )

            return {
              output,
              content: [...lines, answer ? `Latest answer:\n${answer}` : "No answer yet."].join("\n"),
            }
          }).pipe(Effect.mapError(failure("Unable to read the worker's task"))),
      })
    })
  }),
}
