import type { ElectrobunConfig } from "electrobun"
import packageJson from "./package.json"
import { appIdentifier, portableAppIdentifier } from "./electrobun/main/app-identity"
import { APP_NAME } from "./lib/app-meta"

const portable = process.env.XNEON_BUILD_PORTABLE === "1"
const identifier = portable ? portableAppIdentifier : appIdentifier
const artifactChannel = process.env.XNEON_ARTIFACT_CHANNEL ?? "stable"
if (!["stable", "canary", "dev"].includes(artifactChannel)) throw new Error("Invalid artifact channel")

if (portable && (process.platform !== "win32" || process.arch !== "x64" || artifactChannel !== "dev")) {
  throw new Error("Portable requires Windows x64 and the Electrobun dev channel")
}

export default {
  app: {
    name: APP_NAME,
    identifier,
    version: packageJson.version,
    description: packageJson.description,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "electrobun/main/bootstrap.ts", external: ["bun:sqlite", "bun:ffi"], define: { XNEON_PORTABLE_BUILD: JSON.stringify(portable), XNEON_DEV_HMR: JSON.stringify(artifactChannel === "dev" && !portable && process.env.XNEON_DEV_HMR === "1"), XNLC_APPLICATION_USER_AGENT: JSON.stringify(`Xneon-Launcher/${packageJson.version}`) } },
    buildFolder: portable ? "build-electrobun/portable" : "build-electrobun",
    artifactFolder: "release-electrobun/" + artifactChannel,
    copy: {
      dist: "views/launcher",
      "dist-workers": "bun/workers",
      "assets/native/nfd": "native/nfd",
      "assets/steve-skin.png": "views/launcher/assets/steve-skin.png",
      "assets/steve-skin.b64": "views/launcher/assets/steve-skin.b64",
    },
    win: { defaultRenderer: "native", bundleCEF: false, icon: "build/icon.ico" },
    mac: { defaultRenderer: "native", bundleCEF: false, createDmg: true },
    linux: { defaultRenderer: "cef", bundleCEF: true },
  },
  scripts: { postBuild: "scripts/set-windows-executable-identity.ts" },
  runtime: { exitOnLastWindowClosed: false, appUserModelId: identifier },
} satisfies ElectrobunConfig
