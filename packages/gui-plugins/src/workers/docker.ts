import { execFile } from "node:child_process"
import { access, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, connect } from "node:net"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import dockerfile from "./Dockerfile?raw"
import entrypoint from "./entrypoint.sh?raw"

// One container and one volume, so the worker keeps its work when its image is rebuilt for a new app version.
export const CONTAINER = "jacode-worker"

const IMAGE = CONTAINER

export class DockerError extends Error {
  constructor(
    readonly problem: "docker-missing" | "docker-stopped" | "docker" | "binary",
    detail = "",
  ) {
    super(detail)
  }
}

// An app opened from the Dock gets a short PATH that leaves Docker's usual homes out.
const HOMES = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", path.join(homedir(), ".docker/bin/docker")]

async function binary() {
  const found = await Promise.all(
    HOMES.map((file) =>
      access(file).then(
        () => file,
        () => undefined,
      ),
    ),
  )

  return found.find((file) => file !== undefined) ?? "docker"
}

/** Runs one docker command and gives back what it printed. */
export async function docker(args: readonly string[], timeout = 60_000) {
  const command = await binary()

  return new Promise<string>((resolve, reject) =>
    execFile(command, [...args], { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout.trim())

      reject(
        new DockerError(
          "code" in error && error.code === "ENOENT" ? "docker-missing" : "docker",
          (stderr || error.message).trim().slice(-2_000),
        ),
      )
    }),
  )
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const until = async <A>(tries: number, wait: number, attempt: () => Promise<A | undefined>): Promise<A | undefined> => {
  const found = await attempt().catch(() => undefined)

  if (found !== undefined || tries <= 1) return found
  await pause(wait)

  return until(tries - 1, wait, attempt)
}

/** The processor Docker runs containers on, starting Docker Desktop first when it is installed but not running. */
export async function engine() {
  const arch = () => docker(["version", "--format", "{{.Server.Arch}}"], 15_000)

  const running = await arch().catch((error: DockerError) => {
    if (error.problem === "docker-missing") throw error

    return undefined
  })

  if (running) return running

  if (process.platform === "darwin") await new Promise((resolve) => execFile("open", ["-ga", "Docker"], resolve))
  const started = await until(30, 3_000, arch)

  if (!started) throw new DockerError("docker-stopped")

  return started
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      // A TCP listener's address is an object; only a pipe's is text.
      server.close(() => (address instanceof Object ? resolve(address.port) : reject(new Error("no port"))))
    })
  })

const answers = (port: number) =>
  new Promise<true | undefined>((resolve) => {
    const socket = connect(port, "127.0.0.1")

    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => resolve(undefined))
  })

/**
 * Brings the Docker worker up and says where it answers. The image is built once per app version, from the server
 * binary of that version; a container left from another version is replaced and keeps its volume. `step` hears
 * each stage as it finishes.
 */
export async function ensureWorker(input: {
  version: string
  binaries: string
  port?: number
  step: (name: string, detail: string) => void
}) {
  const arch = await engine()
  input.step("docker", `running (${arch})`)
  const image = `${IMAGE}:${input.version}`

  if (!(await docker(["image", "inspect", image, "--format", "{{.Id}}"]).catch(() => undefined))) {
    const context = await mkdtemp(path.join(tmpdir(), "jacode-worker-image-"))

    try {
      await copyFile(
        path.join(input.binaries, `opencode-linux-${arch === "amd64" ? "x64" : "arm64"}`),
        path.join(context, "opencode"),
      ).catch(() => {
        throw new DockerError("binary", arch)
      })
      await writeFile(path.join(context, "Dockerfile"), dockerfile)
      await writeFile(path.join(context, "entrypoint.sh"), entrypoint)
      await docker(["build", "-t", image, context], 30 * 60_000)
    } finally {
      await rm(context, { recursive: true, force: true })
    }

    // Images of other app versions are of no use any more, and each is large.
    const old = (await docker(["images", IMAGE, "--format", "{{.Repository}}:{{.Tag}}"]))
      .split("\n")
      .filter((tag) => tag && tag !== image)

    await Promise.all(old.map((tag) => docker(["rmi", tag]).catch(() => undefined)))
  }

  input.step("image", image)

  const found = await docker(["inspect", CONTAINER, "--format", "{{.Config.Image}} {{.State.Running}}"]).catch(
    () => undefined,
  )

  if (found && !found.startsWith(`${image} `)) await docker(["rm", "-f", CONTAINER])

  if (!found || !found.startsWith(`${image} `))
    await docker([
      "run",
      "-d",
      "--name",
      CONTAINER,
      "--restart",
      "unless-stopped",
      "--shm-size=1g",
      "-p",
      // The port it had before, so the app's tabs on it still find it; else any free one.
      `127.0.0.1:${input.port ?? (await freePort())}:4096`,
      "-p",
      "127.0.0.1::6080",
      "-v",
      `${CONTAINER}:/home/worker`,
      image,
    ])
  else if (found.endsWith(" false")) await docker(["start", CONTAINER])

  input.step("container", CONTAINER)

  const port = Number((await docker(["port", CONTAINER, "4096/tcp"])).split("\n")[0]?.split(":").pop())

  if (!Number.isInteger(port)) throw new DockerError("docker", "The worker has no port.")

  // The password is made inside the container on its first start.
  const password = await until(30, 2_000, () =>
    docker(["exec", CONTAINER, "cat", "/home/worker/.worker-password"]).then((text) => text || undefined),
  )

  if (!password || !(await until(30, 2_000, () => answers(port))))
    throw new DockerError("docker", "The worker did not answer.")

  input.step("worker", `answering on port ${port}`)

  return { port, http: { url: `http://127.0.0.1:${port}`, password } }
}
