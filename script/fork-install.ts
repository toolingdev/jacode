#!/usr/bin/env bun
import { $ } from "bun"
import { exists, readdir, rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// Fork feature: the fork's upgrade path. The packaged fork never self-updates, because the update feeds serve
// upstream's builds, so upgrading means building this checkout and replacing the installed app with the result.
//
//   bun script/fork-install.ts             build this checkout and install it
//   bun script/fork-install.ts --upstream  merge upstream/dev first, then build and install
//   bun script/fork-install.ts --open      open the app once it is installed
//
// macOS only. The replaced app goes to the Trash, so putting it back is the way to roll back.
if (process.platform !== "darwin") throw new Error("fork-install only installs the macOS app")

const root = path.resolve(import.meta.dir, "..")

const target = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"

const env = { ...process.env, OPENCODE_TARGET: target, OPENCODE_CHANNEL: "dev" }

process.chdir(root)

if (process.argv.includes("--upstream")) {
  // A merge needs a clean tree: a conflict is then undone with `git merge --abort` and nothing else is lost.
  if ((await $`git status --porcelain --untracked-files=no`.text()).trim())
    throw new Error("Commit or stash your changes before merging upstream")
  await $`git fetch upstream dev`
  await $`git merge --no-edit upstream/dev`
}

await $`bun install`

await $`bun run build --single`.cwd("packages/cli").env(env)

await $`bun run build`.cwd("packages/desktop").env(env)

await $`bun run pack`.cwd("packages/desktop").env(env)

const built = path.join(root, "packages/desktop/dist", process.arch === "arm64" ? "mac-arm64" : "mac")

const bundle = (await readdir(built)).find((file) => file.endsWith(".app"))

if (!bundle) throw new Error(`No .app bundle in ${built}`)

const installed = path.join("/Applications", bundle)

const id = (
  await $`/usr/libexec/PlistBuddy -c ${"Print :CFBundleIdentifier"} ${path.join(built, bundle, "Contents/Info.plist")}`.text()
).trim()

// Ask a running copy to quit, and wait for it: replacing the bundle under a live app corrupts what it has loaded.
await $`osascript -e ${`if application id "${id}" is running then tell application id "${id}" to quit`}`
  .nothrow()
  .quiet()

const stopped = async (tries: number): Promise<boolean> => {
  if ((await $`pgrep -f ${path.join(installed, "Contents/MacOS")}`.nothrow().quiet()).exitCode !== 0) return true
  if (tries === 0) return false
  await Bun.sleep(500)
  return stopped(tries - 1)
}

if (!(await stopped(40))) throw new Error(`${bundle} is still running; quit it and run this again`)

if (await exists(installed))
  await rename(
    installed,
    path.join(
      homedir(),
      ".Trash",
      `${path.basename(bundle, ".app")} ${new Date().toISOString().replace(/[:.]/g, "-")}.app`,
    ),
  )

await $`ditto ${path.join(built, bundle)} ${installed}`

console.log(`Installed ${installed} from ${(await $`git describe --always --dirty`.text()).trim()}`)

if (process.argv.includes("--open")) await $`open ${installed}`
