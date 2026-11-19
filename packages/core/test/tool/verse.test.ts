import { expect, test } from "bun:test"
import { VerseTool } from "../../src/tool/plugin/verse"

test("the Bible add-on is off until a config switches it on, and the latest config wins", () => {
  expect(VerseTool.bible([])).toBeUndefined()
  // SAFETY: bible reads only the type and the experimental add-ons block of each entry.
  const entries = [
    { type: "document", info: { experimental: { addons: { bible: { enabled: true, spanish: true } } } } },
    { type: "document", info: { experimental: { time: { servers: [] } } } },
  ] as never
  expect(VerseTool.bible(entries)).toEqual({ enabled: true, spanish: true })
})

test("the add-on mentions a second language only when Spanish is on", () => {
  expect(VerseTool.instruction(false)).not.toContain("Spanish")
  expect(VerseTool.instruction(true)).toContain("titleAlt")
})
