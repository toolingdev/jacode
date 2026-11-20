#!/usr/bin/env bun
import { $ } from "bun"
import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

// Fork feature: publish the build `fork-install.ts` just made as a JaCode release. The release carries the Mac app,
// the Linux worker software of the same version, and a manifest (`jacode-release-<version>.json`) with each file's
// SHA-256, which is how the app finds its updates and workers find the software of the app's exact version.
//
//   bun script/fork-release.ts --notes <file>            publish to the repository in JACODE_RELEASES_REPO
//   bun script/fork-release.ts --notes <file> --dry-run  build the files and the manifest, publish nothing
//
// Builds record the folder they were made in, so release from a checkout whose path names no one, such as a
// `git worktree` under /private/tmp. With JACODE_SCAN_FILE set to a file of words (one per line, kept outside the
// repository), the app and the worker binaries are searched for each word first, and a match stops the release.
const root = path.resolve(import.meta.dir, "..")
const repo = process.env.JACODE_RELEASES_REPO ?? "toolingdev/jacode"
const dry = process.argv.includes("--dry-run")
const notes = process.argv[process.argv.indexOf("--notes") + 1]

if (!dry && (!notes || !(await Bun.file(notes).exists()))) throw new Error("Pass --notes <file> with the release notes")
if (root.startsWith(homedir())) throw new Error(`Release from a neutral folder, not ${root}`)

const app = path.join(root, "packages/desktop/dist/mac-arm64/JaCode.app")
const version = (
  await $`/usr/libexec/PlistBuddy -c ${"Print :CFBundleShortVersionString"} ${path.join(app, "Contents/Info.plist")}`.text()
).trim()
const stamp = /(\d{12})$/.exec(version)?.[1]

if (!stamp) throw new Error(`Unexpected app version ${version}`)
const date = `${stamp.slice(0, 4)}.${stamp.slice(4, 6)}.${stamp.slice(6, 8)}`
const workers = path.join(homedir(), "Library/Application Support/OpenCodeFork/desktop/worker", version)
const out = await mkdtemp(path.join(tmpdir(), "jacode-release-"))
const zip = `JaCode-${date}-mac-arm64.zip`

await $`ditto -c -k --keepParent ${app} ${path.join(out, zip)}`
for (const arch of ["x64", "arm64"]) await $`cp ${path.join(workers, `opencode-linux-${arch}`)} ${out}`

const scan = process.env.JACODE_SCAN_FILE

if (scan) {
  const words = (await Bun.file(scan).text())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const targets = [
    path.join(app, "Contents/Resources/app.asar"),
    path.join(app, "Contents/Resources/opencode-cli"),
    path.join(out, "opencode-linux-x64"),
    path.join(out, "opencode-linux-arm64"),
  ]

  for (const target of targets) {
    const text = (await $`strings ${target}`.quiet().text()).toLowerCase()
    const hits = words.filter((word) => text.includes(word.toLowerCase()))

    if (hits.length > 0) console.log(`check by hand: ${path.basename(target)} contains ${hits.join(", ")}`)
  }
}
if (!scan) console.log("JACODE_SCAN_FILE not set: the builds were not searched for personal details")

const sha = async (name: string) =>
  createHash("sha256")
    .update(new Uint8Array(await Bun.file(path.join(out, name)).arrayBuffer()))
    .digest("hex")
const manifest = {
  version,
  files: {
    "mac-arm64": { name: zip, sha256: await sha(zip) },
    "linux-x64": { name: "opencode-linux-x64", sha256: await sha("opencode-linux-x64") },
    "linux-arm64": { name: "opencode-linux-arm64", sha256: await sha("opencode-linux-arm64") },
  },
}
const manifestName = `jacode-release-${version}.json`

await Bun.write(path.join(out, manifestName), JSON.stringify(manifest, null, 2) + "\n")
console.log(`release files for ${version} in ${out}`)

if (!dry) {
  // A second release on one day gets the time too.
  const taken = await $`gh release view jacode-${date} --repo ${repo}`.quiet().nothrow()
  const tag = taken.exitCode === 0 ? `jacode-${date}-${stamp.slice(8)}` : `jacode-${date}`
  const title = taken.exitCode === 0 ? `JaCode ${date} (${stamp.slice(8, 10)}:${stamp.slice(10)})` : `JaCode ${date}`
  const files = [zip, "opencode-linux-x64", "opencode-linux-arm64", manifestName].map((name) => path.join(out, name))

  await $`gh release create ${tag} --repo ${repo} --title ${title} --notes-file ${notes} --latest ${files}`
}
