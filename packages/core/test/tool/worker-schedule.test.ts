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
