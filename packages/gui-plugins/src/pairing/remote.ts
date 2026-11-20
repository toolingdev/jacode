/**
 * The origin another device opens to reach this machine from anywhere, or undefined while the server advertises none.
 * The server itself listens over plain HTTP, so the HTTPS address among its URLs is its remote access tunnel.
 */
export function remoteAddress(urls: readonly string[]) {
  return urls.map((value) => URL.parse(value)).find((url) => url?.protocol === "https:")?.origin
}

/**
 * Fork feature: which way in an address belongs to, read from the address alone, so the dialog can name each link.
 * JaCode serves Tailscale on 8443 and Funnel on 10000 (see the CLI's RemoteAccess).
 */
export function addressMethod(address: string) {
  const url = URL.parse(address)

  if (!url) return "custom"

  if (url.hostname.endsWith(".ts.net")) return url.port === "10000" ? "funnel" : "tailscale"

  if (url.hostname.endsWith(".opentunnel.xyz")) return "opentunnel"

  if (url.protocol === "http:" && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return "lan"

  return "custom"
}
