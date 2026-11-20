import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { byVersion, download, type Target } from "../jacode-release"
import { binaryName } from "./report"
import { parseAddress, runOn, SshError } from "./ssh"
import script from "./update.sh?raw"

/**
 * Fork feature: workers follow the app's version. A worker set up by JaCode is brought to the app's exact version over
 * ssh: the worker says what runs and whether it is busy, the server software of the app's version is sent, and the
 * worker swaps it in, restarts, and checks that it answers with the new version; when it does not, it puts the
 * previous software back. A busy worker is left alone until it is idle, so no task or chat is cut off.
 */

export type Outcome =
  | { readonly state: "current" | "updated"; readonly version: string }
  | { readonly state: "busy" | "rolled-back"; readonly version: string }
  | { readonly state: "offline" | "unmanaged" | "failed"; readonly version?: string; readonly message?: string }

/**
 * The path of the worker software for a processor at this version: the copy the app's install left beside it, else
 * one downloaded from the release of this version, checked against its SHA-256.
 */
export async function obtain(input: { readonly binaries: string; readonly version: string; readonly name: string }) {
  const file = path.join(input.binaries, input.name)
  const here = await access(file).then(
    () => true,
    () => false,
  )

  if (here) return file
  const release = await byVersion(input.version, AbortSignal.timeout(30_000))
  const asset = release?.file(input.name.replace("opencode-", "") as Target)

  if (!asset) throw new Error(`No release carries the worker software for version ${input.version}`)
  await download(asset, file)

  return file
}

/** Brings one worker to `version`, or says why not now. `step` hears progress for the app to show. */
export async function updateWorker(input: {
  readonly target: string
  readonly version: string
  readonly binaries: string
  readonly step: (state: "downloading" | "updating") => void
}): Promise<Outcome> {
  const address = parseAddress(input.target)
  const run = (mode: "probe" | "install", timeout: number) =>
    runOn({
      address,
      command: `f="$(mktemp)" && cat > "$f"; env UPDATE_MODE=${mode} UPDATE_VERSION=${input.version} bash "$f" </dev/null 2>&1; rm -f "$f"`,
      stdin: script,
      timeout,
    }).then(parse)

  const probe = await run("probe", 60_000).catch((error: Error) => error)

  if (probe instanceof SshError && probe.problem === "connection") return { state: "offline" }
  if (probe instanceof Error) return { state: "failed", message: probe.message }
  if (probe.state === "unmanaged") return { state: "unmanaged" }
  const version = probe.version ?? ""

  if (version.endsWith(input.version)) return { state: "current", version: input.version }
  // An answer the worker could not give counts as busy: a restart is only safe when it is known to be idle.
  if (probe.busy !== "no") return { state: "busy", version }
  const name = binaryName(probe.arch ?? "")

  if (!name) return { state: "failed", version, message: `Unsupported processor ${probe.arch}` }
  input.step("downloading")
  const binary = await readFile(await obtain({ binaries: input.binaries, version: input.version, name }))

  input.step("updating")
  await runOn({ address, command: "cat > /tmp/opencode.new && chmod 755 /tmp/opencode.new", stdin: binary, timeout: 20 * 60_000 })
  const result = await run("install", 3 * 60_000)

  if (result.state === "updated") return { state: "updated", version: input.version }
  if (result.state === "rolled-back") return { state: "rolled-back", version }

  return { state: "failed", version, message: `The worker could not install the update (${result.state ?? "no answer"})` }
}

/** The `key=value` lines the worker printed. */
export function parse(output: string): Partial<Record<"arch" | "version" | "busy" | "state", string>> {
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^(arch|version|busy|state)=(.*)$/.exec(line.trim()))
      .flatMap((match) => (match ? [[match[1], match[2]]] : [])),
  )
}
