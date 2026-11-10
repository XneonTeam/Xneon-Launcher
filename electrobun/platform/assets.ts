import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

const routes = new Map<string, (request: Request) => Response | Promise<Response>>()
const secret = randomBytes(24).toString("hex")
let server: ReturnType<typeof Bun.serve> | undefined

export const protocol = {
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>) {
    routes.set(scheme, handler)
  },
}

export const net = {
  fetch(url: string, options?: RequestInit) {
    return url.startsWith("file:") ? Promise.resolve(new Response(Bun.file(fileURLToPath(url)))) : fetch(url, options)
  },
}

export function assetBase() {
  server ??= Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const [, token, scheme, ...parts] = url.pathname.split("/")
      const handler = routes.get(scheme)
      if (token !== secret || !handler || request.method !== "GET" || !parts[0]) {
        return new Response(null, { status: 404 })
      }
      const response = await handler(new Request(scheme + "://" + parts.join("/") + url.search))
      const headers = new Headers(response.headers)
      headers.set("Access-Control-Allow-Origin", "*")
      headers.set("Referrer-Policy", "no-referrer")
      return new Response(response.body, { status: response.status, headers })
    },
  })
  return server.url.origin + "/" + secret + "/"
}
