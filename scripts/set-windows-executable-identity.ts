import path from "node:path"

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
  const result = Bun.spawnSync([
    "powershell.exe", "-NoProfile", "-NonInteractive", "-File",
    path.join(import.meta.dir, "set-windows-executable-identity.ps1"), path.resolve(wrapper),
  ], { stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error("Could not set Windows executable identity")
  console.log("Set Xneon Launcher executable identity")
}

await setWindowsExecutableIdentity()
