import { registerCallbackBridge } from "./auth-callback-bridge"

const matchers = [
  { prefix: "http://localhost:51234/elyby/callback", channel: "auth:elyby-callback" },
  { prefix: "https://login.live.com/oauth20_desktop.srf", channel: "auth:microsoft-callback" },
]

for (const name of ["authBridge", "elyByAuth", "microsoftAuth"]) {
  registerCallbackBridge(name, matchers)
}