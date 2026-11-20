import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Schema } from "effect"

/**
 * Fork feature: JaCode's own releases on GitHub, where the app updates itself from and where workers get the server
 * software of the app's exact version. Each release carries a manifest named `jacode-release-<version>.json` that
 * lists its files with their SHA-256, so a version is found by name without opening every release.
 */

// Overridable for testing: another repository, or a local server that answers like GitHub's releases API.
const REPO = process.env.JACODE_RELEASES_REPO ?? "toolingdev/jacode"
const API = process.env.JACODE_RELEASES_API ?? `https://api.github.com/repos/${REPO}`
const MANIFEST = /^jacode-release-(.+)\.json$/

const File = Schema.Struct({ name: Schema.String, sha256: Schema.String })
const Manifest = Schema.Struct({
  version: Schema.String,
  files: Schema.Struct({
    "mac-arm64": Schema.optionalKey(File),
    "linux-x64": Schema.optionalKey(File),
    "linux-arm64": Schema.optionalKey(File),
  }),
})
const decodeManifest = Schema.decodeUnknownSync(Manifest)

const Asset = Schema.Struct({ name: Schema.String, browser_download_url: Schema.String })
const Release = Schema.Struct({ tag_name: Schema.String, assets: Schema.Array(Asset) })
const decodeRelease = Schema.decodeUnknownSync(Release)
const decodeReleases = Schema.decodeUnknownSync(Schema.Array(Release))

export type Target = keyof typeof Manifest.Type.files

/** A release's version, its files, and where each one downloads from. */
export type Found = {
  readonly version: string
  readonly tag: string
  readonly file: (target: Target) => { readonly url: string; readonly sha256: string; readonly name: string } | undefined
}

/** The newest published release, or undefined when it carries no manifest (older releases had none). */
export async function latest(signal?: AbortSignal): Promise<Found | undefined> {
  return open(decodeRelease(await json(`${API}/releases/latest`, signal)), signal)
}

/** The release of exactly this version, from the most recent ones, or undefined when none was published. */
export async function byVersion(version: string, signal?: AbortSignal): Promise<Found | undefined> {
  const releases = decodeReleases(await json(`${API}/releases?per_page=50`, signal))
  const release = releases.find((item) => item.assets.some((asset) => asset.name === `jacode-release-${version}.json`))

  return release ? open(release, signal) : undefined
}

/**
 * Whether `next` is newer than `current`. JaCode versions end in a build time (`0.0.0-dev-202611201646`), so the
 * trailing number decides; anything else falls back to plain text order.
 */
export function newer(next: string, current: string) {
  const stamp = (version: string) => /(\d{8,})$/.exec(version)?.[1]
  const a = stamp(next)
  const b = stamp(current)

  if (a && b) return a.length === b.length ? a > b : a.length > b.length

  return next !== current && next.localeCompare(current, undefined, { numeric: true }) > 0
}

/** Downloads a release file to `path`, checking its SHA-256; a file that does not match is removed. */
export async function download(file: { readonly url: string; readonly sha256: string }, path: string, signal?: AbortSignal) {
  await mkdir(dirname(path), { recursive: true })
  const response = await fetch(file.url, { signal, headers: { "user-agent": "JaCode" } })

  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`)
  const hash = createHash("sha256")
  const partial = `${path}.partial`
  const reader = response.body.getReader()

  await pipeline(
    Readable.from(
      (async function* () {
        while (true) {
          const next = await reader.read()

          if (next.done) return
          hash.update(next.value)
          yield next.value
        }
      })(),
    ),
    createWriteStream(partial),
    { signal },
  )
  const actual = hash.digest("hex")

  if (actual !== file.sha256.toLowerCase()) {
    await rm(partial, { force: true })
    throw new Error("The download did not match its checksum")
  }
  await rename(partial, path)
}

async function open(release: typeof Release.Type, signal?: AbortSignal): Promise<Found | undefined> {
  const asset = release.assets.find((item) => MANIFEST.test(item.name))

  if (!asset) return undefined
  const manifest = decodeManifest(await json(asset.browser_download_url, signal))
  const url = (name: string) => release.assets.find((item) => item.name === name)?.browser_download_url

  return {
    version: manifest.version,
    tag: release.tag_name,
    file: (target) => {
      const entry = manifest.files[target]
      const where = entry && url(entry.name)

      return entry && where ? { url: where, sha256: entry.sha256, name: entry.name } : undefined
    },
  }
}

async function json(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    headers: { accept: "application/vnd.github+json", "user-agent": "JaCode" },
  })

  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`)

  return response.json()
}
