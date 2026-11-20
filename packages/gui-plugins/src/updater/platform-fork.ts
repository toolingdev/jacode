import { execFile, spawn } from "node:child_process"
import { access, constants, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { Effect } from "effect"
import { download, latest, newer, type Found } from "../jacode-release"
import type { Platform } from "./machine"

const execFileAsync = promisify(execFile)

/**
 * Fork feature: JaCode updates itself from its own GitHub releases. The app is not signed with a Developer ID, which
 * Squirrel.Mac (behind electron-updater) requires, so this platform does the work itself: it downloads the release's
 * Mac zip, checks its SHA-256 and the version inside, and on restart a small detached script waits for the app to
 * quit, moves the old app aside, copies the new one in its place and opens it. When the copy fails, the old app is
 * put back and opened. The old app is kept beside the download until the next update, not in the Trash, which macOS
 * closes to apps without Full Disk Access.
 */
export const make = Effect.fn("Updater.platform.fork")(function* () {
  const staging = join(app.getPath("temp"), "jacode-update")
  // The running app bundle: JaCode.app/Contents/MacOS/JaCode.
  const bundle = dirname(dirname(dirname(app.getPath("exe"))))
  const found: { release?: Found } = {}

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        const release = await latest(AbortSignal.timeout(30_000))

        if (!release || !newer(release.version, app.getVersion()) || !release.file("mac-arm64")) return undefined
        found.release = release

        return { mode: "restart", version: release.version } as const
      },
      catch: (error) => error,
    }),
    stageUpdate: () =>
      Effect.tryPromise({
        try: async () => {
          const release = found.release
          const file = release?.file("mac-arm64")

          if (!release || !file) throw new Error("No update was found to download")
          await access(dirname(bundle), constants.W_OK)
          await rm(staging, { recursive: true, force: true })
          await mkdir(staging, { recursive: true })
          const zip = join(staging, file.name)

          await download(file, zip)
          await execFileAsync("/usr/bin/ditto", ["-x", "-k", zip, staging])
          await rm(zip, { force: true })
          const version = await plist(join(staging, "JaCode.app"), "CFBundleShortVersionString")
          const id = await plist(join(staging, "JaCode.app"), "CFBundleIdentifier")

          if (version !== release.version) throw new Error(`The download holds version ${version}, not ${release.version}`)
          if (id !== (await plist(bundle, "CFBundleIdentifier"))) throw new Error("The download is a different app")
          await execFileAsync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", join(staging, "JaCode.app")]).catch(
            () => undefined,
          )
        },
        catch: (error) => error,
      }),
    installAndRestart: Effect.tryPromise({
      try: async () => {
        const script = join(staging, "install.sh")

        await writeFile(script, INSTALL, { mode: 0o755 })
        spawn("/bin/sh", [script, String(process.pid), join(staging, "JaCode.app"), bundle], {
          detached: true,
          stdio: "ignore",
        }).unref()
        // The lifecycle is already quitting for the handoff; nothing else ends the app.
        setTimeout(() => app.quit(), 0)
      },
      catch: (error) => error,
    }),
  } satisfies Platform
})

async function plist(bundle: string, key: string) {
  const result = await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(bundle, "Contents/Info.plist")])

  return result.stdout.trim()
}

// $1 the app's pid, $2 the new app, $3 where the app is installed.
const INSTALL = `#!/bin/sh
pid="$1"; staged="$2"; target="$3"
exec >>"$(dirname "$staged")/install.log" 2>&1
echo "install $(date)"
# The app quits on its own; one that is still there after 20 seconds has closed its windows and is stuck, so stop it.
i=0
while kill -0 "$pid" 2>/dev/null && [ $i -lt 200 ]; do sleep 0.1; i=$((i+1)); done
if kill -0 "$pid" 2>/dev/null; then echo "app did not quit, stopping it"; kill "$pid"; sleep 3; kill -9 "$pid" 2>/dev/null; fi
old="$(dirname "$staged")/JaCode-previous.app"
rm -rf "$old"
mv "$target" "$old" || { echo "could not move the old app"; open "$target"; exit 1; }
if ditto "$staged" "$target"; then
  touch "$target"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$target" 2>/dev/null
  rm -rf "$staged"
  echo "installed"
else
  echo "copy failed, putting the old app back"
  rm -rf "$target"; mv "$old" "$target"
fi
open "$target"
`
