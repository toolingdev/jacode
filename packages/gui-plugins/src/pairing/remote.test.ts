import { describe, expect, test } from "bun:test"
import { addressMethod, remoteAddress } from "./remote"

test.each([
  [
    "the tunnel among the server's own addresses",
    [
      "http://127.0.0.1:49374",
      "http://192.168.10.248:49374",
      "http://100.87.251.43:49374",
      "https://cbf8424f2044b16d.vcybm3xt4hhu.opentunnel.xyz",
    ],
    "https://cbf8424f2044b16d.vcybm3xt4hhu.opentunnel.xyz",
  ],
  ["nothing while the tunnel is off or still connecting", ["http://127.0.0.1:49374", "http://192.168.10.248:49374"], undefined],
  ["nothing from a malformed address", ["not a url"], undefined],
])("remote address: %s", (_, urls, expected) => {
  expect(remoteAddress(urls)).toBe(expected)
})

describe("addressMethod", () => {
  test("names each way in by its address", () => {
    expect(addressMethod("https://mac.tail123.ts.net:8443")).toBe("tailscale")
    expect(addressMethod("https://mac.tail123.ts.net:10000")).toBe("funnel")
    expect(addressMethod("https://a1b2.c3d4.opentunnel.xyz")).toBe("opentunnel")
    expect(addressMethod("http://192.168.0.20:49374")).toBe("lan")
    expect(addressMethod("http://172.20.1.4:49374")).toBe("lan")
    expect(addressMethod("https://jacode.example.com")).toBe("custom")
  })
})
