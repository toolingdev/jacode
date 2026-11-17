#!/usr/bin/env bun
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Fork feature: sets a machine up as a worker, a server the desktop app connects to and hands work. It builds this
// checkout's server for the machine, copies it over with `packages/gui-plugins/src/workers/setup.sh`, and runs that there. The script
// checks the machine first (Linux with systemd, 2 cores, 4 GB of memory, 10 GB of disk, sudo, internet, a free
// port) and changes nothing unless every check passes. Running it again updates the worker and keeps its password,
// config and work. `fork-worker.ts` is the quick way to update a worker that is already set up.
//
//   bun script/fork-worker-setup.ts user@host            a server, VM or VPS reached over ssh
//   bun script/fork-worker-setup.ts --local              this machine (Linux)
//   bun script/fork-worker-setup.ts --docker             build the image `jacode-worker` for a machine with Docker
//
//   --check            only run the checks
//   --listen <address> where the server listens (default: the machine's Tailscale address, else 127.0.0.1)
//   --port <number>    default 4096
//   --browser, --no-browser   a real browser on a virtual screen; by default installed when the machine has 8 GB
const args = process.argv.slice(2)
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const valued = new Set([value("--listen"), value("--port")])
const host = args.find((arg) => !arg.startsWith("--") && !valued.has(arg))
const local = args.includes("--local")
const docker = args.includes("--docker")

if ([host !== undefined, local, docker].filter(Boolean).length !== 1)
  throw new Error("Say where: an ssh address such as user@host, --local, or --docker")

const root = path.resolve(import.meta.dir, "..")
const setup = path.join(root, "packages/gui-plugins/src/workers/setup.sh")

const settings = {
  WORKER_MODE: args.includes("--check") ? "check" : "install",
  WORKER_BROWSER: args.includes("--no-browser") ? "no" : args.includes("--browser") ? "yes" : "auto",
  ...(value("--listen") ? { WORKER_LISTEN: value("--listen") } : {}),
  ...(value("--port") ? { WORKER_PORT: value("--port") } : {}),
}

// The server binary for a machine's processor, built from this checkout.
const build = async (machine: string) => {
  const target = machine === "aarch64" || machine === "arm64" ? "linux-arm64" : "linux-x64"
  const out = await mkdtemp(path.join(tmpdir(), "fork-worker-"))

  await $`bun run build --outdir=${out}`
    .cwd(path.join(root, "packages/cli"))
    .env({ ...process.env, OPENCODE_TARGET: target, OPENCODE_CHANNEL: "dev" })
    .quiet()

  return { out, binary: path.join(out, `cli-${target}/bin/opencode`) }
}

if (docker) {
  const machine = (await $`docker version --format ${"{{.Server.Arch}}"}`.text()).trim()
  const built = await build(machine)
  const context = await mkdtemp(path.join(tmpdir(), "fork-worker-image-"))

  await $`cp ${built.binary} ${path.join(context, "opencode")}`
  await $`cp ${path.join(root, "packages/gui-plugins/src/workers/Dockerfile")} ${path.join(root, "packages/gui-plugins/src/workers/entrypoint.sh")} ${context}`
  await $`docker build -t jacode-worker ${context}`
  await rm(built.out, { recursive: true })
  await rm(context, { recursive: true })
  console.log(
    [
      "Image jacode-worker is built. Start a worker with:",
      "  docker run -d --name jacode-worker --shm-size=1g -p 4096:4096 -p 127.0.0.1:6080:6080 -v jacode-worker:/home/worker jacode-worker",
      "Then get its pairing link with:",
      "  docker logs jacode-worker",
    ].join("\n"),
  )
  process.exit(0)
}

const env = Object.entries(settings).map(([name, text]) => `${name}=${text}`)

if (local) {
  if (process.platform !== "linux") throw new Error("--local sets up a Linux machine. On this one, use --docker.")
  const built = settings.WORKER_MODE === "check" ? undefined : await build(process.arch === "arm64" ? "arm64" : "x86_64")

  await $`env ${env} ${built ? [`WORKER_BINARY=${built.binary}`] : []} bash ${setup}`
  if (built) await rm(built.out, { recursive: true })
  process.exit(0)
}

await $`scp -q ${setup} ${`${host}:/tmp/jacode-worker-setup.sh`}`

// The checks run first on their own, so a machine that cannot be a worker is told before anything is built.
await $`ssh ${host} ${`env ${env.join(" ")} WORKER_MODE=check WORKER_BINARY=/tmp/jacode-worker-setup.sh bash /tmp/jacode-worker-setup.sh`}`

if (settings.WORKER_MODE === "install") {
  const built = await build((await $`ssh ${host} uname -m`.text()).trim())

  await $`scp -q ${built.binary} ${`${host}:/tmp/opencode.new`}`
  await rm(built.out, { recursive: true })
  await $`ssh ${host} ${`env ${env.join(" ")} bash /tmp/jacode-worker-setup.sh`}`
}

await $`ssh ${host} rm -f /tmp/jacode-worker-setup.sh`
