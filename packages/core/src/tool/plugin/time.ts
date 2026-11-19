export * as TimeTool from "./time.js"

import { createSocket } from "node:dgram"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"

// Fork feature: the exact time, read from NTP servers rather than trusted from this computer's clock, so the model
// can reason precisely about market opens, deadlines and schedules. The servers are listed in config
// (`experimental.time.servers`) and tried in order; the clock's own offset from them is reported too.

export const name = "time"

export const description = `Get the exact current time from internet time servers (NTP), in UTC and in a time zone, with how far this computer's clock is off. Use this whenever the precise time matters: before scheduling something, judging whether a market or business is open, or counting down to a deadline. Do not guess the time from the conversation.`

export const Input = Schema.Struct({
  timezone: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'An IANA time zone such as "America/Los_Angeles" or "America/New_York". Defaults to this computer\'s.',
    }),
  ),
})

export const Output = Schema.Struct({
  source: Schema.String,
  utc: Schema.String,
  unixMs: Schema.Finite,
  timezone: Schema.String,
  local: Schema.String,
  clockOffsetMs: Schema.Finite,
  roundTripMs: Schema.Finite,
  /** How many hops the server is from a reference clock; null when no server answered. */
  stratum: Schema.NullOr(Schema.Finite),
})
export type Output = typeof Output.Type

export const DEFAULT_SERVERS = ["time.cloudflare.com", "time.google.com", "pool.ntp.org"]

// Seconds between the NTP epoch (1900) and the Unix epoch (1970).
const NTP_EPOCH = 2_208_988_800
const TIMEOUT_MS = 2_000

/** The servers the time tool asks, from the latest config that lists them, else the defaults. */
export function servers(entries: readonly Entry[]) {
  const listed = entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.time !== undefined,
  )?.info.experimental?.time?.servers

  return listed && listed.length > 0 ? listed : DEFAULT_SERVERS
}

/** An SNTP reading from one packet: the server's time when it answered, and this clock's offset from it. */
export function readNtp(packet: Uint8Array, sentMs: number, receivedMs: number) {
  if (packet.length < 48) return undefined
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  const stamp = (offset: number) =>
    (view.getUint32(offset) - NTP_EPOCH) * 1000 + (view.getUint32(offset + 4) / 2 ** 32) * 1000
  const serverReceived = stamp(32)
  const serverSent = stamp(40)
  const offset = (serverReceived - sentMs + (serverSent - receivedMs)) / 2
  const roundTrip = receivedMs - sentMs - (serverSent - serverReceived)

  return { offset, roundTrip, stratum: packet[1] ?? 0 }
}

// One SNTP request to a server over UDP port 123.
function ask(host: string) {
  return Effect.tryPromise({
    try: () =>
      new Promise<ReturnType<typeof readNtp>>((resolve, reject) => {
        const socket = createSocket("udp4")
        const request = new Uint8Array(48)
        // Leap indicator 0, version 4, mode 3 (client).
        request[0] = 0x23
        const sent = Date.now()
        const timer = setTimeout(() => {
          socket.close()
          reject(new Error("timed out"))
        }, TIMEOUT_MS)

        socket.once("error", (error) => {
          clearTimeout(timer)
          socket.close()
          reject(error)
        })
        socket.once("message", (message) => {
          clearTimeout(timer)
          socket.close()
          resolve(readNtp(message, sent, Date.now()))
        })
        socket.send(request, 123, host)
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export const Plugin = {
  id: "opencode.tool.time",
  effect: Effect.fn("TimeTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        // Pinned, so the model always sees it can read the exact time.
        options: { codemode: true, pinned: true },
        description,
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.gen(function* () {
            const list = servers(yield* config.entries())
            const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

            // Each server in turn; the first that answers sets the time. When none does, the clock is all there is.
            const from = (index: number): Effect.Effect<{ host: string; reading: ReturnType<typeof readNtp> }> => {
              const host = list[index]

              if (host === undefined) return Effect.succeed({ host: "", reading: undefined })

              return ask(host).pipe(
                Effect.flatMap((reading) =>
                  reading ? Effect.succeed({ host, reading }) : Effect.fail(new Error("bad")),
                ),
                Effect.catch(() => from(index + 1)),
              )
            }

            const found = yield* from(0)
            const offset = found.reading?.offset ?? 0
            const now = new Date(Date.now() + offset)

            const local = new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              dateStyle: "full",
              timeStyle: "long",
              hourCycle: "h12",
            }).format(now)

            const output: Output = {
              source: found.reading ? found.host : "this computer's clock (no time server answered)",
              utc: now.toISOString(),
              unixMs: now.getTime(),
              timezone,
              local,
              clockOffsetMs: Math.round(offset),
              roundTripMs: Math.round(found.reading?.roundTrip ?? 0),
              stratum: found.reading?.stratum ?? null,
            }

            return {
              output,
              content: `${local} (${timezone}); ${output.utc} UTC. Source: ${output.source}. This computer's clock is off by ${output.clockOffsetMs} ms; round trip ${output.roundTripMs} ms.`,
            }
          }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to get the time", error }))),
      }),
    )
  }),
}
