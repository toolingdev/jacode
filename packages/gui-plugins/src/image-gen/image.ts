/** The aspect ratios the dialog offers, as the generate API takes them. */
export const aspects = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const

export type Aspect = (typeof aspects)[number]

/** How many images one request may ask for. */
export const counts = ["1", "2", "3", "4"] as const

export type Count = (typeof counts)[number]

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"

  if (mime === "image/png") return "png"

  if (mime === "image/webp") return "webp"

  if (mime === "image/gif") return "gif"

  return "img"
}

/**
 * Where one generated image is saved, relative to the session's directory: a name that sorts by time and never
 * collides within a request. `at` is local time. An image type without a known extension is saved as `.img`.
 */
export function imagePath(at: Date, index: number, mime: string) {
  const pad = (value: number) => String(value).padStart(2, "0")
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`

  return `generated-images/image-${day}-${time}-${index + 1}.${extension(mime)}`
}

/** The bytes of base64 data, as the file write API takes them. */
export function imageBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** One model reference as a select value, and back. Model IDs may contain slashes; provider IDs never do. */
export function modelValue(model: { readonly providerID: string; readonly id: string }) {
  return `${model.providerID}/${model.id}`
}

export function modelRef(value: string) {
  const index = value.indexOf("/")

  return { providerID: value.slice(0, index), id: value.slice(index + 1) }
}
