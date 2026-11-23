import { expect, test } from "bun:test"
import { WorkerScheduleTools } from "../../src/tool/plugin/worker-schedule"

const list = [
  { name: "worker", url: "http://100.64.0.10:4096" },
  { name: "Lab Box", url: "http://10.0.0.2:4096" },
]

test("a worker is picked by name without regard to case, and the only one when none is named", () => {
  expect(WorkerScheduleTools.pick(list, "lab box")?.url).toBe("http://10.0.0.2:4096")
  expect(WorkerScheduleTools.pick(list, "nope")).toBeUndefined()
  expect(WorkerScheduleTools.pick(list, undefined)).toBeUndefined()
  expect(WorkerScheduleTools.pick(list.slice(0, 1), undefined)?.name).toBe("worker")
})

test("the newest answer's text is read from a worker chat's messages", () => {
  const messages = {
    data: [
      { type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "newest" }] },
      { type: "user", time: { created: 3 }, content: [{ type: "text", text: "question" }] },
      { type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "older" }] },
    ],
  }

  expect(WorkerScheduleTools.latestAnswer(messages)).toBe("newest")
  expect(WorkerScheduleTools.latestAnswer({ data: [] })).toBeUndefined()
  expect(WorkerScheduleTools.latestAnswer("nonsense")).toBeUndefined()
})

test("a worker chat's finished runs are each prompt with its answer, once the run went idle", () => {
  const messages = {
    data: [
      { id: "u1", type: "user", time: { created: 1 } },
      { id: "a1", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "first answer" }] },
      { id: "i1", type: "idle", time: { created: 3 } },
      { id: "u2", type: "user", time: { created: 4 } },
      { id: "a2", type: "assistant", time: { created: 5 }, content: [{ type: "text", text: "still going" }] },
    ],
  }

  expect(WorkerScheduleTools.finishedRuns(messages)).toEqual([{ id: "u1", text: "first answer", at: 3 }])
  expect(WorkerScheduleTools.finishedRuns({ data: "nope" })).toEqual([])
})

test("a chat's linked worker tasks come from its metadata, and none when it has none", () => {
  expect(WorkerScheduleTools.linkedTasks(undefined)).toEqual([])
  expect(WorkerScheduleTools.linkedTasks({ workerTasks: [{ worker: "w", sessionID: "s" }] })).toEqual([
    { worker: "w", sessionID: "s" },
  ])
})

test("a task handed to a worker keeps its kind, so its answer is checked for until it comes back", () => {
  expect(
    WorkerScheduleTools.linkedTasks({ workerTasks: [{ worker: "w", sessionID: "s", title: "Build", kind: "now" }] }),
  ).toEqual([{ worker: "w", sessionID: "s", title: "Build", kind: "now" }])
})

test("a worker chat received a task when it holds a prompt", () => {
  expect(WorkerScheduleTools.received({ data: [{ type: "user" }] })).toBe(true)
  expect(WorkerScheduleTools.received({ data: [] })).toBe(false)
  expect(WorkerScheduleTools.received(undefined)).toBe(false)
})
