#!/usr/bin/env bun
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Fork feature: puts this checkout's server on a remote worker, so the worker and the desktop app run the same
// build and no feature exists on one and not the other. Run it after `fork-install.ts`, from the same commit.
//
//   JACODE_WORKER_HOST=user@host bun script/fork-worker.ts
//
// The worker is a Linux x64 machine reached over ssh, running the server as the systemd unit `opencode-worker`
// from /opt/opencode/bin. The binary it replaces is kept beside it as `opencode.prev`, which is the way back.
// Restarting the unit stops whatever the worker is in the middle of.
const host = process.env.JACODE_WORKER_HOST

if (!host) throw new Error("Set JACODE_WORKER_HOST to the worker's ssh address, e.g. user@host")

const root = path.resolve(import.meta.dir, "..")
const out = await mkdtemp(path.join(tmpdir(), "fork-worker-"))

await $`bun run build --outdir=${out}`
  .cwd(path.join(root, "packages/cli"))
  .env({ ...process.env, OPENCODE_TARGET: "linux-x64", OPENCODE_CHANNEL: "dev" })

await $`scp -q ${path.join(out, "cli-linux-x64/bin/opencode")} ${`${host}:/tmp/opencode.new`}`

await $`ssh ${host} ${[
  "set -e",
  "sudo cp /opt/opencode/bin/opencode /opt/opencode/opencode.prev",
  "sudo install -m 755 /tmp/opencode.new /opt/opencode/bin/opencode",
  "rm -f /tmp/opencode.new",
  "sudo systemctl restart opencode-worker",
  "sleep 4",
  "systemctl is-active opencode-worker",
  "/opt/opencode/bin/opencode --version",
].join(" && ")}`

await rm(out, { recursive: true })

console.log(`Worker ${host} now runs ${(await $`git describe --always --dirty`.text()).trim()}`)
