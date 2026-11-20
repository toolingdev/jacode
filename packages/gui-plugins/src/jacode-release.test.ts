import { expect, test } from "bun:test"
import { newer } from "./jacode-release"

test("a later build time is newer, whatever the length of the rest", () => {
  expect(newer("0.0.0-dev-202611211200", "0.0.0-dev-202611201646")).toBe(true)
  expect(newer("0.0.0-dev-202611201646", "0.0.0-dev-202611201646")).toBe(false)
  expect(newer("0.0.0-dev-202611190900", "0.0.0-dev-202611201646")).toBe(false)
  expect(newer("2.4.0", "2.3.0")).toBe(true)
})
