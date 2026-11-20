import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { assertOwnedEndpoint, processTree } from "./linux-process-evidence"
import { stopUnixProcessGroup } from "./unix-process-cleanup"

/** Нативный smoke: CEF/CDP, отрисованный React и настоящий renderer → main IPC. */
export async function smokeLinuxCef(executable: string, output: string, profile?: string) {
  assert.equal(process.platform, "linux")
  assert.equal(process.arch, "x64")
  assert.ok(process.env.DISPLAY, "An X11 display (Xvfb is supported) is required")
  await mkdir(output, { recursive: true })
  profile ??= await mkdtemp(path.join(os.tmpdir(), "xneon-cef-smoke-"))
  const nonce = randomUUID()
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) })
  const port = server.port!
  server.stop(true)
  let logs = ""
  const child = spawn(path.resolve(executable), [], {
    cwd: path.dirname(path.resolve(executable)), detached: true,
    env: { ...process.env, ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(port), XNLC_E2E_NONCE: nonce, XNEON_BUN_DATA_DIR: profile, HOME: profile, XDG_DATA_HOME: path.join(profile, "data"), XDG_CONFIG_HOME: path.join(profile, "config"), XDG_CACHE_HOME: path.join(profile, "cache"), XNLC_LIVEOPS_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-2 * 1024 ** 2) })
  child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-2 * 1024 ** 2) })
  let spawnError: Error | undefined
  child.on("error", error => { spawnError = error })
  let socket: WebSocket | undefined
  let screenshotOnFailure: (() => Promise<void>) | undefined
  const deadline = Date.now() + 90000
  try {
    let target: { webSocketDebuggerUrl?: string } | undefined
    while (Date.now() < deadline && !target) {
      if (spawnError) throw spawnError
      assert.equal(child.exitCode, null, "Application exited before creating a CEF page")
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) }).then(response => response.json()).catch(() => []) as { type: string; url: string; webSocketDebuggerUrl: string }[]
      target = pages.find(page => page.type === "page" && page.url.startsWith("views://launcher/"))
      if (!target) await Bun.sleep(500)
    }
    assert.ok(target?.webSocketDebuggerUrl, "CEF did not expose the packaged launcher page; no WebKit fallback is accepted")
    assert.ok(child.pid)
    await assertOwnedEndpoint(port, (await processTree(child.pid)).map(row => row.pid), nonce)
    const endpoint = new URL(target.webSocketDebuggerUrl)
    assert.ok(endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost")
    assert.equal(Number(endpoint.port), port)
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CEF CDP connection timeout")), 10000)
      socket!.onopen = () => { clearTimeout(timer); resolve() }
      socket!.onerror = () => { clearTimeout(timer); reject(new Error("CEF CDP connection failed")) }
    })
    let id = 0
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data))
      const request = pending.get(message.id)
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result) }
    }
    const command = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("CDP timeout: " + method)) }, 10000)
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket!.send(JSON.stringify({ id: requestId, method, params }))
    })
    screenshotOnFailure = async () => { const screenshot = await command("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, "failure.png"), Buffer.from(screenshot.data, "base64")) }
    let evidence: any
    while (Date.now() < deadline) {
      const result = await command("Runtime.evaluate", { expression: `(async () => {
        if (!window.electrobunAPI || !document.querySelector('#root')?.children.length) return null;
        const startupError = await window.electrobunAPI.startupReady();
        if (startupError) throw new Error(startupError);
        const settings = await window.electrobunAPI.getSettings(['theme']);
        return { userAgent: navigator.userAgent, rendered: !!document.querySelector('[data-ui="app-div-1"]')?.getBoundingClientRect().width, ipc: typeof settings === 'object' && settings !== null, width: innerWidth, height: innerHeight };
      })()`, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, "Renderer/IPC exception: " + JSON.stringify(result.exceptionDetails))
      evidence = result.result?.value
      if (evidence?.rendered && evidence.ipc) break
      await Bun.sleep(500)
    }
    assert.ok(evidence?.rendered && evidence.ipc && evidence.width > 0 && evidence.height > 0, "UI or IPC did not become ready")
    assert.match(evidence.userAgent, /Chrome\//, "Expected Chromium user agent")
    const bundle = await realpath(path.dirname(path.resolve(executable)))
    let mappedLibcef = false
    const tree = await processTree(child.pid)
    await writeFile(path.join(output, "processes.json"), JSON.stringify(tree, null, 2))
    assert.ok(tree.some(row => row.args.includes("--type=renderer") && row.executable.startsWith(bundle + "/")), "No bundled Chromium renderer subprocess")
    assert.ok(!tree.some(row => /WebKitWebProcess|WebKitNetworkProcess/.test(row.executable)), "System WebView subprocess detected")
    for (const { pid } of tree) {
      const maps = await readFile(`/proc/${pid}/maps`, "utf8").catch(() => "")
      if (maps.split("\n").some(line => line.includes(bundle + "/") && line.includes("libcef.so"))) mappedLibcef = true
    }
    assert.ok(mappedLibcef, "No running process mapped the bundled libcef.so")
    const evaluate = async (expression: string) => {
      const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      assert.ok(!result.exceptionDetails, "UI action failed: " + JSON.stringify(result.exceptionDetails))
      return result.result?.value
    }
    const click = async (selector: string) => {
      const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
      assert.ok(point, "Missing UI control: " + selector)
      await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point })
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point })
    }
    if (await evaluate(`!!document.querySelector('[data-component="onboarding-modal"]')`)) {
      await click('[data-component="onboarding-modal"] [data-modal-close]')
      await Bun.sleep(500)
    }
    await click('[data-sidebar-item="settings"] button')
    let settingsVisible = false
    for (let attempt = 0; attempt < 30 && !settingsVisible; attempt++) {
      settingsVisible = await evaluate(`!!document.querySelector('#settings-page')?.getBoundingClientRect().width`)
      if (!settingsVisible) await Bun.sleep(250)
    }
    assert.ok(settingsVisible, "Navigation to settings did not update the visible interface")
    const screenshot = await command("Page.captureScreenshot", { format: "png" })
    await writeFile(path.join(output, "launcher.png"), Buffer.from(screenshot.data, "base64"))
    await writeFile(path.join(output, "smoke.json"), JSON.stringify({ ...evidence, nonce, bundledLibcefMapped: true, settingsNavigation: true, e2e: "renderer-ipc-smoke-passed", updates: "NOT RUN", installation: "NOT RUN", restart: "NOT RUN" }, null, 2))
  } catch (error) {
    await screenshotOnFailure?.().catch(() => {})
    await writeFile(path.join(output, "failure.txt"), String(error))
    throw error
  } finally {
    if (child.pid) await writeFile(path.join(output, "processes-final.json"), JSON.stringify(await processTree(child.pid), null, 2)).catch(() => {})
    socket?.close()
    try {
      if (child.pid) {
        const cleanup = await stopUnixProcessGroup(child.pid)
        await writeFile(path.join(output, "shutdown.json"), JSON.stringify(cleanup))
        assert.ok(!cleanup.forced, "Native launch required SIGKILL")
      }
    } finally { await writeFile(path.join(output, "launcher.log"), logs) }
  }
}

if (import.meta.main) {
  const [executable, output] = Bun.argv.slice(2)
  assert.ok(executable && output, "Usage: smoke-linux-cef <launcher> <evidence-directory>")
  const profile = await mkdtemp(path.join(os.tmpdir(), "xneon-cef-smoke-"))
  for (let pass = 1; pass <= 2; pass++) await smokeLinuxCef(executable, path.join(output, `run-${pass}`), profile)
}
