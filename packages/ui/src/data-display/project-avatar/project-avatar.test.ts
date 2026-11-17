import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import { getProjectAvatarColor, getProjectAvatarSource, pickProjectAvatarVariant } from "./project-avatar"

describe("getProjectAvatarSource", () => {
  test("prefers a chosen image, then a chosen color, then the automatic icon", () => {
    expect(getProjectAvatarSource("abc", { override: "data:image/png;base64,AA==", url: "data:auto" })).toBe(
      "data:image/png;base64,AA==",
    )
    expect(getProjectAvatarSource("abc", { color: "blue", url: "data:auto" })).toBeUndefined()
    expect(getProjectAvatarSource("abc", { url: "data:auto" })).toBe("data:auto")
  })

  test("recognizes the OpenCode repository by its remote-derived project ID", () => {
    const id = createHash("sha1").update("git-remote:github.com/anomalyco/opencode").digest("hex")

    expect(getProjectAvatarSource(id)).toBe("https://opencode.ai/favicon.svg")
    expect(getProjectAvatarSource(id, { override: "data:custom" })).toBe("data:custom")
    expect(getProjectAvatarSource(id, { color: "blue" })).toBeUndefined()
  })
})

describe("getProjectAvatarColor", () => {
  test("keeps a chosen color, gray included", () => {
    expect(getProjectAvatarColor({ id: "abc", icon: { color: "pink" } })).toBe("pink")
    expect(getProjectAvatarColor({ id: "abc", icon: { color: "gray" } })).toBe("gray")
  })

  test("picks the same non-gray color for the same project every time", () => {
    const color = getProjectAvatarColor({ id: "abc", worktree: "/work/one" })

    expect(color).not.toBe("gray")
    expect(getProjectAvatarColor({ id: "abc", worktree: "/work/two" })).toBe(color)
  })

  test("tells folders without a project of their own apart by directory", () => {
    const colors = ["/a", "/b", "/c", "/d", "/e", "/f"].map((worktree) =>
      getProjectAvatarColor({ id: "global", worktree }),
    )

    expect(new Set(colors).size).toBeGreaterThan(1)
  })

  test("is gray when there is nothing to pick from", () => {
    expect(getProjectAvatarColor()).toBe("gray")
  })
})

describe("pickProjectAvatarVariant", () => {
  test("stays inside the palette it is given", () => {
    expect(pickProjectAvatarVariant("http://worker:4096", ["orange"])).toBe("orange")
  })
})
