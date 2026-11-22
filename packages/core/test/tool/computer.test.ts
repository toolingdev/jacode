import { describe, expect, test } from "bun:test"
import { ComputerTool } from "../../src/tool/plugin/computer"

describe("ComputerTool.plan", () => {
  test("a screenshot alone needs no driver command", () => {
    expect(ComputerTool.plan({ action: "screenshot" })).toBeUndefined()
  })

  test("a click defaults to one left click", () => {
    expect(ComputerTool.plan({ action: "click", x: 10, y: 20 })).toEqual({
      action: "click",
      x: 10,
      y: 20,
      button: "left",
      count: 1,
    })
  })

  test("a right double click keeps its button and count", () => {
    expect(ComputerTool.plan({ action: "click", x: 1, y: 2, button: "right", count: 2 })).toMatchObject({
      button: "right",
      count: 2,
    })
  })

  test("a scroll defaults to no movement on the axis it leaves out", () => {
    expect(ComputerTool.plan({ action: "scroll", x: 5, y: 5, down: 3 })).toEqual({
      action: "scroll",
      x: 5,
      y: 5,
      down: 3,
      right: 0,
    })
  })

  test("actions refuse missing fields", () => {
    expect(() => ComputerTool.plan({ action: "click", x: 1 })).toThrow("click needs x and y")
    expect(() => ComputerTool.plan({ action: "drag", x: 1, y: 1 })).toThrow("drag needs toX and toY")
    expect(() => ComputerTool.plan({ action: "type" })).toThrow("type needs text")
    expect(() => ComputerTool.plan({ action: "key", keys: " " })).toThrow("key needs keys")
  })
})

describe("ComputerTool.switchedOn", () => {
  test("only the chat's ask rule for the tool switches it on", () => {
    expect(ComputerTool.switchedOn([{ action: "computer", resource: "*", effect: "ask" }])).toBe(true)
    expect(ComputerTool.switchedOn([{ action: "*", resource: "*", effect: "allow" }])).toBe(false)
    expect(ComputerTool.switchedOn([{ action: "computer", resource: "*", effect: "allow" }])).toBe(false)
    expect(ComputerTool.switchedOn(undefined)).toBe(false)
  })
})
