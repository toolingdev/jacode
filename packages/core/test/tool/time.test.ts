import { expect, test } from "bun:test"
import { TimeTool } from "../../src/tool/plugin/time"

// An NTP timestamp for a Unix time in ms: seconds since 1900, then the fraction of a second in 32 bits.
const stamp = (view: DataView, offset: number, ms: number) => {
  view.setUint32(offset, Math.floor(ms / 1000) + 2_208_988_800)
  view.setUint32(offset + 4, Math.round(((ms % 1000) / 1000) * 2 ** 32))
}

test("an NTP answer gives this clock's offset and the round trip without the server's own delay", () => {
  const packet = new Uint8Array(48)
  const view = new DataView(packet.buffer)
  packet[1] = 2
  // Sent at 1000 and received at 1100 here; the server was 500 ms ahead and spent 20 ms answering.
  stamp(view, 32, 1_540)
  stamp(view, 40, 1_560)

  const reading = TimeTool.readNtp(packet, 1_000, 1_100)

  expect(Math.round(reading?.offset ?? 0)).toBe(500)
  expect(Math.round(reading?.roundTrip ?? 0)).toBe(80)
  expect(reading?.stratum).toBe(2)
  expect(TimeTool.readNtp(new Uint8Array(10), 0, 0)).toBeUndefined()
})

test("the time servers come from config, else the defaults", () => {
  expect(TimeTool.servers([])).toEqual(TimeTool.DEFAULT_SERVERS)
  // SAFETY: servers reads only the type and the experimental time block of each entry.
  const entries = [{ type: "document", info: { experimental: { time: { servers: ["ntp.example.test"] } } } }] as never
  expect(TimeTool.servers(entries)).toEqual(["ntp.example.test"])
})
