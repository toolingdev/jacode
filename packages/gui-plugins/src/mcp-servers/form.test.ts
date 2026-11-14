import { describe, expect, test } from "bun:test"
import { emptyMcpForm, readMcpForm, splitCommand } from "./form"

describe("MCP server form", () => {
  test("reads a local command with quoted arguments and environment variables", () => {
    expect(
      readMcpForm(
        {
          ...emptyMcpForm,
          name: " files ",
          command: `npx -y @scope/server "/Users/me/My Documents" --label='two words'`,
          environment: "API_KEY={env:MY_API_KEY}\n\n  MODE = a=b ",
        },
        [],
      ),
    ).toEqual({
      ok: true,
      name: "files",
      config: {
        type: "local",
        command: ["npx", "-y", "@scope/server", "/Users/me/My Documents", "--label=two words"],
        environment: { API_KEY: "{env:MY_API_KEY}", MODE: "a=b" },
      },
    })
  })

  test("reads a remote URL with headers and ignores the local fields", () => {
    expect(
      readMcpForm(
        {
          ...emptyMcpForm,
          name: "docs",
          type: "remote",
          command: `broken "quote`,
          url: " https://example.com/mcp ",
          headers: "Authorization: Bearer {env:TOKEN}",
        },
        [],
      ),
    ).toEqual({
      ok: true,
      name: "docs",
      config: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer {env:TOKEN}" } },
    })
  })

  test("leaves out empty environment and headers", () => {
    expect(readMcpForm({ ...emptyMcpForm, name: "a", command: "run" }, [])).toEqual({
      ok: true,
      name: "a",
      config: { type: "local", command: ["run"] },
    })
    expect(readMcpForm({ ...emptyMcpForm, name: "a", type: "remote", url: "http://localhost:1/mcp" }, [])).toEqual({
      ok: true,
      name: "a",
      config: { type: "remote", url: "http://localhost:1/mcp" },
    })
  })

  test("reports every field to fix at once", () => {
    expect(readMcpForm({ ...emptyMcpForm, name: "has space", command: "  ", environment: "NOVALUE" }, [])).toEqual({
      ok: false,
      errors: { name: "name.invalid", command: "command.required", environment: "environment.invalid" },
    })
    expect(
      readMcpForm({ ...emptyMcpForm, name: "", type: "remote", url: "ftp://example.com", headers: ": x" }, []),
    ).toEqual({ ok: false, errors: { name: "name.required", url: "url.invalid", headers: "headers.invalid" } })
  })

  test("refuses a name already in use and an unclosed quote", () => {
    expect(readMcpForm({ ...emptyMcpForm, name: "docs", command: `run "open` }, ["docs"])).toEqual({
      ok: false,
      errors: { name: "name.taken", command: "command.quote" },
    })
  })

  test("splits a command into arguments", () => {
    expect(splitCommand("  a   b  ")).toEqual(["a", "b"])
    expect(splitCommand(`a "" 'b c'd`)).toEqual(["a", "", "b cd"])
    expect(splitCommand("")).toEqual([])
    expect(splitCommand(`a 'b`)).toBeUndefined()
  })
})
