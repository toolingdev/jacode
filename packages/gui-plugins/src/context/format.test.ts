import { expect, test } from "bun:test"
import { statShare, usageTone } from "./format"

test("context usage turns from comfortable to filling to nearly full", () => {
  expect([0, 59, 60, 84, 85, 120].map(usageTone)).toEqual([
    "success",
    "success",
    "warning",
    "warning",
    "danger",
    "danger",
  ])
})

test("usage without a known context limit has no tone", () => {
  expect(usageTone(null)).toBeUndefined()
  expect(usageTone(undefined)).toBeUndefined()
})

test("a share is the part of its whole, kept within the bar", () => {
  expect(statShare(50, 200)).toBe(0.25)
  expect(statShare(300, 200)).toBe(1)
  expect(statShare(0, 200)).toBe(0)
})

test("a share needs a whole to measure against", () => {
  expect(statShare(5, 0)).toBeUndefined()
  expect(statShare(5, undefined)).toBeUndefined()
  expect(statShare(undefined, 200)).toBeUndefined()
})
