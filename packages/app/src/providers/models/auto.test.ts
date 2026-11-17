import { expect, test } from "bun:test"
import { AUTO, autoImageModel, isAutoModel, resolveAutoModel } from "./auto"

const catalog = new Set(["nano:deepseek", "nano:kimi", "other:gpt"])

const input = (fallback?: { providerID: string; modelID: string }) => ({
  valid: (model: { providerID: string; modelID: string }) => catalog.has(`${model.providerID}:${model.modelID}`),
  fallback: () => fallback,
  first: (providerID: string) => (providerID === "nano" ? { providerID, modelID: "deepseek" } : undefined),
})

const everywhere = { providerID: AUTO, modelID: AUTO }

const withinNano = { providerID: "nano", modelID: AUTO }

const kimi = { providerID: "nano", modelID: "kimi" }

const gpt = { providerID: "other", modelID: "gpt" }

test("only an auto model ID is an Auto choice", () => {
  expect(isAutoModel(everywhere)).toBe(true)
  expect(isAutoModel(withinNano)).toBe(true)
  expect(isAutoModel(kimi)).toBe(false)
})

test("Auto across providers uses the chosen model, else the default", () => {
  expect(resolveAutoModel(everywhere, { all: kimi, providers: {} }, input(gpt))).toEqual(kimi)
  expect(resolveAutoModel(everywhere, { providers: {} }, input(gpt))).toEqual(gpt)
  expect(resolveAutoModel(everywhere, { all: { providerID: "nano", modelID: "gone" }, providers: {} }, input(gpt))).toEqual(
    gpt,
  )
})

test("Auto within a provider uses that provider's chosen model", () => {
  expect(resolveAutoModel(withinNano, { all: gpt, providers: { nano: "kimi" } }, input(gpt))).toEqual(kimi)
})

test("Auto within a provider never leaves it", () => {
  expect(resolveAutoModel(withinNano, { providers: {} }, input(kimi))).toEqual(kimi)
  expect(resolveAutoModel(withinNano, { providers: { nano: "gone" } }, input(gpt))).toEqual({
    providerID: "nano",
    modelID: "deepseek",
  })
  expect(resolveAutoModel({ providerID: "other", modelID: AUTO }, { providers: {} }, input(kimi))).toBeUndefined()
})

const reader = (id: string, image: boolean) => ({ id, capabilities: { input: { text: true, image } } })

test("Auto sends a prompt with images to the image model", () => {
  expect(autoImageModel(reader("deepseek", false), reader("kimi", true), true).id).toBe("kimi")
})

test("Auto keeps a usual model that reads images", () => {
  expect(autoImageModel(reader("qwen", true), reader("kimi", true), true).id).toBe("qwen")
})

test("Auto accepts images before one is attached, without leaving its usual model", () => {
  expect(autoImageModel(reader("deepseek", false), reader("kimi", true), false)).toEqual(reader("deepseek", true))
})

test("Auto without a usable image model is unchanged", () => {
  const usual = reader("deepseek", false)

  expect(autoImageModel(usual, undefined, true)).toBe(usual)
  expect(autoImageModel(usual, reader("glm", false), true)).toBe(usual)
})
