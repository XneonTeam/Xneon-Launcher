import { registerCallbackBridge } from "./auth-callback-bridge"

registerCallbackBridge("xnSkinsAuth", [
  { prefix: "http://localhost:5123/xneon/callback", channel: "auth:xnskins-callback" },
])