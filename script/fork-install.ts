#!/usr/bin/env bun
import { $ } from "bun"
import { exists, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

// Fork feature: the fork's upgrade path. The packaged fork never self-updates, because the update feeds serve
// upstream's builds, so upgrading means building this checkout and replacing the installed app with the result.
//
//   bun script/fork-install.ts             build this checkout and install it
//   bun script/fork-install.ts --upstream  merge upstream/dev first, then build and install
//   bun script/fork-install.ts --open      open the app once it is installed
//   bun script/fork-install.ts --no-worker skip building the Linux servers the Workers page installs elsewhere
//
// macOS only. The replaced app goes to the Trash, so putting it back is the way to roll back.
if (process.platform !== "darwin") throw new Error("fork-install only installs the macOS app")

const root = path.resolve(import.meta.dir, "..")

const target = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"

// One version for everything built here. The app only connects over SSH to a worker of its own version, so the
// worker binaries below carry the same one as the app.
const version = `0.0.0-dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`

const env = { ...process.env, OPENCODE_TARGET: target, OPENCODE_CHANNEL: "dev", OPENCODE_VERSION: version }

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

// A copy that closed its windows but did not exit within 20 seconds is stuck quitting; stop it.
if (!(await stopped(40))) {
  console.log(`${bundle} did not quit; stopping it`)
  await $`pkill -f ${path.join(installed, "Contents/MacOS")}`.nothrow().quiet()
  if (!(await stopped(10))) await $`pkill -9 -f ${path.join(installed, "Contents/MacOS")}`.nothrow().quiet()
  if (!(await stopped(10))) throw new Error(`${bundle} is still running; quit it and run this again`)
}

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

// The Dock and Finder cache an app's icon by its path; re-register the bundle so a changed icon shows.
await $`touch ${installed}`
await $`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ${installed}`

console.log(`Installed ${installed} from ${(await $`git describe --always --dirty`.text()).trim()}`)

// The Linux servers the Workers settings page installs on other machines, kept beside the app's own data: they are
// too large to ride inside the app. Older versions' copies are of no use to this app and are removed.
if (!process.argv.includes("--no-worker")) {
  const workers = path.join(homedir(), "Library/Application Support/OpenCodeFork/desktop/worker")

  await rm(workers, { recursive: true, force: true })
  await mkdir(path.join(workers, version), { recursive: true })

  for (const arch of ["x64", "arm64"]) {
    const out = await mkdtemp(path.join(tmpdir(), "fork-worker-"))

    await $`bun run build --outdir=${out}`
      .cwd("packages/cli")
      .env({ ...env, OPENCODE_TARGET: `linux-${arch}` })
      .quiet()
    // A copy, not a move: the two folders can be on different disks.
    await $`cp ${path.join(out, `cli-linux-${arch}/bin/opencode`)} ${path.join(workers, version, `opencode-linux-${arch}`)}`
    await rm(out, { recursive: true })
  }
}

// Opened last: the app updates workers as soon as it starts, from the server files written above.
if (process.argv.includes("--open")) await $`open ${installed}`
