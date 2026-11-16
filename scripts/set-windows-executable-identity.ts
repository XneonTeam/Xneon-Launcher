import path from "node:path"
import packageJson from "../package.json"
import { setWindowsExecutableVersion } from "./windows-version-resource"

async function setWindowsExecutableIdentity() {
  if (process.platform !== "win32") return
  const build = process.env.ELECTROBUN_BUILD_DIR
  const channel = process.env.ELECTROBUN_BUILD_ENV
  if (!build || (channel !== "stable" && channel !== "canary" && channel !== "dev")) throw new Error("Electrobun build identity is missing")
  const wrapper = path.join(build, channel === "stable" ? "XneonLauncher" : "XneonLauncher-" + channel)
  const relative = path.relative(path.resolve(import.meta.dir, ".."), path.resolve(wrapper))
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Electrobun wrapper is outside the project")
  }
  if (!await Bun.file(path.join(wrapper, "bin", "bun.exe")).exists()) throw new Error("Packaged Bun executable is missing")
  for (const file of ["bun.exe", "launcher.exe"]) {
    await setWindowsExecutableVersion(path.resolve(wrapper, "bin", file), packageJson.version)
  }
  console.log("Set Xneon Launcher executable identity")
}

await setWindowsExecutableIdentity()
