import { expect, test } from "bun:test"
import { parse } from "./update"

test("reads the worker's answer lines and ignores the rest", () => {
  expect(parse("Warning: something\narch=x86_64\nversion=0.0.0-dev-202611201646\nbusy=no\n")).toEqual({
    arch: "x86_64",
    version: "0.0.0-dev-202611201646",
    busy: "no",
  })
  expect(parse("state=rolled-back")).toEqual({ state: "rolled-back" })
})
