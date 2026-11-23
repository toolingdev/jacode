export * as WorkerScheduleTools from "./worker-schedule.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Automation } from "@opencode/schema/automation"
import { Duration, Effect, Option, Schedule as EffectSchedule, Schema, SchemaGetter } from "effect"
import { Config } from "../../config.js"

// Fork feature: a chat on this computer hands a scheduled task to a worker, so it runs there even while this computer
// sleeps or is off. The task gets its own chat on the worker, which keeps the results. The chat that scheduled it
// remembers that worker chat in its metadata (`workerTasks`), and this computer checks those worker chats when it
// starts and every minute after: each run that finished is delivered back into the chat once, which then tells the
// user. While this computer is off, results wait on the worker. Workers are listed in config
// (`experimental.workers`), which the desktop app keeps in step with the workers it is connected to.
//
// worker_task hands a task to a worker to run now, the way a subagent runs here, so long or heavy work does not load
// this computer. It gets its own worker chat too, and its answer comes back the same way, checked every few seconds
// until it has arrived.

const TIMEOUT_MS = 15_000

// How often linked worker chats are checked for finished runs, and how long after start the first check waits.
const POLL = Duration.minutes(1)
const FIRST_POLL = Duration.seconds(10)
// How often a chat waiting on a task handed to a worker is checked, until its answer has come back.
const TASK_POLL = Duration.seconds(10)

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

/**
 * The runs of a worker chat that have finished, oldest first: each prompt the chat was woken with, the answer it
 * gave, and when it finished. A run still going, with no idle mark after its prompt yet, is left for the next check.
 */
export function finishedRuns(messages: unknown) {
  const list = Schema.decodeUnknownOption(MessageList)(messages)

  if (list._tag === "None") return []
  const sorted = list.value.data.toSorted((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

  return sorted.flatMap((message, index) => {
    if (message.type !== "user" || !message.id) return []
    const next = sorted.findIndex((other, at) => at > index && other.type === "user")
    const run = sorted.slice(index + 1, next === -1 ? undefined : next)
    const idle = run.find((other) => other.type === "idle")

    if (!idle) return []
    const text = run
      .filter((other) => other.type === "assistant")
      .flatMap((other) => (other.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])))
      .join("\n")
      .trim()

    return text ? [{ id: message.id, text, at: idle.time?.created ?? 0 }] : []
  })
}

/** Whether a worker chat's message list holds a prompt. */
export function received(messages: unknown) {
  const list = Schema.decodeUnknownOption(MessageList)(messages)

  return list._tag === "Some" && list.value.data.some((message) => message.type === "user")
}

/** The worker chats a chat scheduled tasks in, from its metadata. */
export function linkedTasks(metadata: unknown) {
  return Option.getOrElse(Schema.decodeUnknownOption(Linked)(metadata), () => ({ workerTasks: [] })).workerTasks
}

const Task = Schema.Struct({
  worker: Schema.String,
  sessionID: Schema.String,
  title: Schema.optionalKey(Schema.String),
  delivered: Schema.optionalKey(Schema.Array(Schema.String)),
  // "now" for a task handed over with worker_task; scheduled tasks have none.
  kind: Schema.optionalKey(Schema.Literal("now")),
})
const Linked = Schema.Struct({ workerTasks: Schema.Array(Task) })

const MessageList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
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
  ...Automation.Request.fields,
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
      lastRunAt: Schema.optionalKey(Schema.String),
      lastOutcome: Schema.optionalKey(Schema.String),
    }),
  ),
  answer: Schema.NullOr(Schema.String),
})

const TaskInput = Schema.Struct({
  worker: Schema.optionalKey(WorkerName),
  title: Schema.String.annotate({ description: "A short title for the task's chat on the worker." }),
  prompt: Schema.String.annotate({
    description:
      "The task, written to stand alone with every detail the worker needs: it cannot see this chat or this computer's files.",
  }),
})

const TaskOutput = Schema.Struct({ worker: Schema.String, sessionID: Schema.String })

const ListOutput = Schema.Struct({ workers: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })) })

// The parts of an automation the worker sends back that these tools report; its times arrive as Unix milliseconds.
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
  lastRunAt: Schema.optionalKey(Millis),
  lastOutcome: Schema.optionalKey(Schema.String),
})

type LocalSessionID = Parameters<Context["session"]["get"]>[0]["sessionID"]

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

    const link = (sessionID: LocalSessionID, task: typeof Task.Type) =>
      Effect.gen(function* () {
        const session = yield* ctx.session.get({ sessionID })
        const tasks = linkedTasks(session.metadata)

        if (tasks.some((item) => item.worker === task.worker && item.sessionID === task.sessionID)) return
        yield* ctx.session.update({
          sessionID,
          metadata: { ...session.metadata, workerTasks: [...tasks, task] },
        })
      })

    // Brings every finished run of the chat's worker tasks back into it once: as a note the chat's own model reads
    // and passes on, so the user hears the result in the chat that asked for it.
    const deliver = (session: { readonly id: LocalSessionID; readonly metadata?: unknown }) =>
      Effect.gen(function* () {
        const tasks = linkedTasks(session.metadata)
        const list = workers(yield* config.entries())

        const updated = yield* Effect.forEach(tasks, (task) =>
          Effect.gen(function* () {
            const worker = pick(list, task.worker)

            if (!worker) return task
            const runs = finishedRuns(
              yield* call(worker, "GET", `/api/session/${encodeURIComponent(task.sessionID)}/message?limit=100`),
            )
            const fresh = runs.filter((run) => !(task.delivered ?? []).includes(run.id))

            yield* Effect.forEach(fresh, (run) =>
              ctx.session.synthetic({
                sessionID: session.id,
                text: `<worker-result>\nThe task "${task.title ?? "Scheduled task"}" that this chat ${task.kind === "now" ? "handed to" : "scheduled on"} the worker ${worker.name} (worker chat ${task.sessionID}) finished at ${new Date(run.at).toISOString()}. Its answer:\n\n${run.text}\n</worker-result>\nTell the user this result now, briefly and in full. Take no other action on it unless the user asks.`,
                description: `Result from ${worker.name}: ${task.title ?? "Scheduled task"}`,
                metadata: { source: "worker", worker: worker.name, workerSessionID: task.sessionID },
              }),
            )

            return fresh.length === 0 ? task : { ...task, delivered: [...(task.delivered ?? []), ...fresh.map((run) => run.id)] }
          }).pipe(Effect.orElseSucceed(() => task)),
        )

        if (updated.every((task, index) => task === tasks[index])) return
        const current = yield* ctx.session.get({ sessionID: session.id })

        // `workerResult` colors the chat's unread dot as news from a worker, until the user writes in it again.
        yield* ctx.session.update({
          sessionID: session.id,
          metadata: { ...current.metadata, workerTasks: updated, workerResult: true },
        })
      }).pipe(Effect.ignore)

    const check = ctx.session.list({ limit: 200 }).pipe(
      Effect.flatMap((page) =>
        Effect.forEach(
          page.data.filter((session) => linkedTasks(session.metadata).length > 0),
          deliver,
          { concurrency: 2 },
        ),
      ),
      Effect.ignore,
    )

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const session = yield* ctx.session.get({ sessionID: event.sessionID })

        if (session.metadata?.workerResult !== true) return
        yield* ctx.session.update({ sessionID: event.sessionID, metadata: { ...session.metadata, workerResult: false } })
      }).pipe(Effect.ignore),
    )

    // Chats waiting on a task handed over with worker_task, checked often until every such answer has come back.
    const waiting = new Set<LocalSessionID>()
    const checkWaiting = Effect.forEach(
      [...waiting],
      (sessionID) =>
        Effect.gen(function* () {
          yield* deliver(yield* ctx.session.get({ sessionID }))
          const tasks = linkedTasks((yield* ctx.session.get({ sessionID })).metadata)

          if (tasks.every((task) => task.kind !== "now" || (task.delivered ?? []).length > 0)) waiting.delete(sessionID)
        }).pipe(Effect.orElseSucceed(() => waiting.delete(sessionID))),
      { discard: true },
    )

    yield* checkWaiting.pipe(
      Effect.repeat(EffectSchedule.spaced(TASK_POLL)),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* Effect.sleep(FIRST_POLL).pipe(
      Effect.andThen(check.pipe(Effect.repeat(EffectSchedule.spaced(POLL)))),
      Effect.forkScoped({ startImmediately: true }),
    )

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
          "Schedule a task on a worker instead of this computer, when the user asks for it to run remotely or it must run while this computer may be asleep or off. Takes the same trigger and action as automation.create; a prompt action goes to the task's chat on the worker. The task gets its own chat on the worker, which wakes with `prompt` and keeps the results; write the prompt so it stands alone, with every detail the worker needs, since it cannot see this chat. Note the returned sessionID: worker_schedule_status reads the results back later.",
        input: ScheduleInput,
        output: ScheduleOutput,
        options: { namespace: "opencode", codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const worker = yield* find(input.worker)
            const session = yield* call(worker, "POST", "/api/session", {
              title: input.title ?? input.name,
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SessionData)),
              Effect.map((value) => value.data),
            )
            // A prompt goes to the worker chat made for it: a target in this computer's chats means nothing there.
            const request = {
              name: input.name,
              trigger: input.trigger,
              expires: input.expires,
              action: input.action.type === "prompt" ? { type: "prompt", prompt: input.action.prompt } : input.action,
            }
            const schedule = yield* call(worker, "POST", "/api/experimental/automation", {
              sessionID: session.id,
              ...request,
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ScheduleData)),
              Effect.map((value) => value.data),
              // A chat left with nothing scheduled in it would only confuse the user.
              Effect.tapError(() => call(worker, "DELETE", `/api/session/${session.id}`).pipe(Effect.ignore)),
            )

            // This chat remembers the worker chat, so its results come back here when they are ready.
            yield* link(context.sessionID, {
              worker: worker.name,
              sessionID: session.id,
              title: input.title ?? input.name,
            }).pipe(Effect.ignore)

            const output = {
              worker: worker.name,
              sessionID: session.id,
              scheduleID: schedule.id,
              status: schedule.status,
              nextDueAt: schedule.nextDueAt,
            }

            return {
              output,
              content: `Scheduled on ${worker.name} (chat ${session.id}, schedule ${schedule.id}): ${schedule.status}${schedule.nextDueAt ? `, next run ${schedule.nextDueAt}` : ""}. Results stay in that chat on ${worker.name}, and each finished run is brought back into this chat when this computer is on; worker_schedule_status reads them at any time.`,
            }
          }).pipe(Effect.mapError(failure("Unable to schedule on the worker"))),
      })

      editor.add({
        name: "worker_task",
        description:
          "Hand a task to a worker to run now, in its own chat there, instead of on this computer: for long or heavy work (builds, test suites, big research or data jobs) that should not load this computer, or that should keep going while it sleeps. Runs in the background like a subagent: its answer comes back into this chat by itself when the worker finishes, so do not poll for it. Write the prompt so it stands alone; the worker cannot see this chat or this computer's files.",
        input: TaskInput,
        output: TaskOutput,
        options: { namespace: "opencode", codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const worker = yield* find(input.worker)
            const session = yield* call(worker, "POST", "/api/session", { title: input.title }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SessionData)),
              Effect.map((value) => value.data),
            )

            // A worker can take the prompt and still fail to answer the request (older builds did), so the worker
            // chat itself says whether the task arrived.
            yield* call(worker, "POST", `/api/session/${encodeURIComponent(session.id)}/prompt`, {
              text: input.prompt,
            }).pipe(
              Effect.catch((error) =>
                call(worker, "GET", `/api/session/${encodeURIComponent(session.id)}/message?limit=5`).pipe(
                  Effect.flatMap((messages) => (received(messages) ? Effect.void : Effect.fail(error))),
                  Effect.tapError(() => call(worker, "DELETE", `/api/session/${session.id}`).pipe(Effect.ignore)),
                ),
              ),
            )
            yield* link(context.sessionID, {
              worker: worker.name,
              sessionID: session.id,
              title: input.title,
              kind: "now",
            }).pipe(Effect.ignore)
            waiting.add(context.sessionID)

            return {
              output: { worker: worker.name, sessionID: session.id },
              content: `${worker.name} is working on "${input.title}" in its chat ${session.id}. Its answer comes back into this chat by itself when it finishes; do not poll for it. Carry on with other work, or tell the user what was handed over and end your response.`,
            }
          }).pipe(Effect.mapError(failure("Unable to hand the task to the worker"))),
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
              `/api/experimental/automation?sessionID=${encodeURIComponent(input.sessionID)}`,
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
