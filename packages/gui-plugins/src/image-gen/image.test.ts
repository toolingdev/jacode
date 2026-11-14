import { describe, expect, test } from "bun:test"
import { imageBytes, imagePath, modelRef, modelValue } from "./image"

describe("generated image helpers", () => {
  test("names a saved image by local time, position and type", () => {
    const at = new Date(2026, 10, 4, 7, 5, 9)

    expect(imagePath(at, 0, "image/jpeg")).toBe("generated-images/image-20261104-070509-1.jpg")
    expect(imagePath(at, 2, "image/png")).toBe("generated-images/image-20261104-070509-3.png")
    expect(imagePath(at, 0, "image/x-unknown")).toBe("generated-images/image-20261104-070509-1.img")
  })

  test("decodes base64 to bytes", () => {
    expect([...imageBytes(btoa(String.fromCharCode(0, 255, 137, 80)))]).toEqual([0, 255, 137, 80])
  })

  test("round-trips a model whose ID holds slashes", () => {
    const model = { providerID: "nanogpt-sub", id: "vendor/z-image/turbo" }

    expect(modelValue(model)).toBe("nanogpt-sub/vendor/z-image/turbo")
    expect(modelRef(modelValue(model))).toEqual(model)
  })
})
