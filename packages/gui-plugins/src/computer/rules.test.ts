import { expect, test } from "bun:test"
import { isOn, withComputer } from "./rules"

const other = { action: "github_*", resource: "*", effect: "deny" } as const

test("switching on adds the ask rule after the chat's own rules", () => {
  const rules = withComputer([other], true)

  expect(rules).toEqual([other, { action: "computer", resource: "*", effect: "ask" }])
  expect(isOn(rules)).toBe(true)
})

test("switching off keeps every other rule", () => {
  expect(withComputer(withComputer([other], true), false)).toEqual([other])
  expect(isOn([other])).toBe(false)
  expect(isOn(undefined)).toBe(false)
})

test("switching on twice keeps one rule", () => {
  expect(withComputer(withComputer([], true), true)).toHaveLength(1)
})
