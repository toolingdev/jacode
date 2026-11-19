import { expect, test } from "bun:test"
import { mascotActivity } from "./saying"
import en from "./sayings/en"
import es from "./sayings/es"

const tool = (name: string) => [{ type: "tool", name }]

test("the companion's line follows the tool the model is running", () => {
  expect(mascotActivity([])).toBe("think")
  expect(mascotActivity([{ type: "reasoning" }])).toBe("think")
  expect(mascotActivity(tool("shell"))).toBe("shell")
  expect(mascotActivity(tool("edit"))).toBe("edit")
  expect(mascotActivity(tool("read"))).toBe("read")
  expect(mascotActivity(tool("grep"))).toBe("read")
  expect(mascotActivity(tool("webfetch"))).toBe("web")
  expect(mascotActivity(tool("browser_navigate"))).toBe("browser")
  expect(mascotActivity(tool("subagent"))).toBe("delegate")
})

test("every companion has lines for every activity in English and Spanish", () => {
  const activities = ["think", "read", "edit", "shell", "web", "browser", "delegate"] as const

  for (const book of [en, es]) {
    expect(Object.keys(book).toSorted()).toEqual([
      "bolt",
      "boo",
      "cap",
      "goop",
      "hoot",
      "merl",
      "mochi",
      "orbit",
      "ribbit",
      "sirbit",
    ])
    expect(Object.values(book).every((lines) => activities.every((kind) => lines[kind].length >= 10))).toBe(true)
  }
})
