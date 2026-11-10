import type { ElectrobunConfig } from "electrobun"
import packageJson from "./package.json"

const identifier = "com.xneonlauncher.app"
const artifactChannel = process.env.XNEON_ARTIFACT_CHANNEL ?? "stable"
if (!["stable", "canary", "dev"].includes(artifactChannel)) throw new Error("Invalid artifact channel")

export default {
  app: {
    name: "Xneon Launcher",
    identifier,
    version: packageJson.version,
    description: packageJson.description,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "electrobun/main/bootstrap.ts", external: ["bun:sqlite", "bun:ffi"] },
    buildFolder: "build-electrobun",
    artifactFolder: "release-electrobun/" + artifactChannel,
    copy: {
      dist: "views/launcher",
      "dist-workers": "bun/workers",
      "assets/steve-skin.png": "views/launcher/assets/steve-skin.png",
      "assets/steve-skin.b64": "views/launcher/assets/steve-skin.b64",
    },
    win: { defaultRenderer: "native", bundleCEF: false, icon: "build/icon.ico" },
    mac: { defaultRenderer: "native", bundleCEF: false },
    linux: { defaultRenderer: "native", bundleCEF: false },
  },
  scripts: { postBuild: "scripts/set-windows-executable-identity.ts" },
  runtime: { exitOnLastWindowClosed: false, appUserModelId: identifier },
} satisfies ElectrobunConfig
