import fs from "node:fs"
import path from "node:path"

// Только локальный CDP. Запросы и их результаты не записываются: остаются имена методов и время.
const endpoint = process.env.XNEON_AUDIT_CDP ?? "http://127.0.0.1:9223"
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)) throw new Error("A local CDP endpoint is required")
const label = process.argv[2] ?? "sample"
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error("Invalid report label")
const pages = await fetch(endpoint + "/json/list").then(response => response.json())
const page = pages.find(page => page.url?.includes("views://launcher"))
if (!page?.webSocketDebuggerUrl) throw new Error("Start the launcher with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223")
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true })
  socket.addEventListener("error", reject, { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data)
  pending.get(message.id)?.(message)
  pending.delete(message.id)
})
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)) }, 30000)
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text)
  return value.result.value
}
const probe = `(() => {
  const audit = window.__launcherAudit = { events: {}, ipc: [], longTasks: [] };
  for (const event of ['app:hydrated','app:revealed','theme:ready']) window.addEventListener(event, () => audit.events[event] = performance.now());
  new PerformanceObserver(list => audit.longTasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  const freeze = Object.freeze;
  Object.freeze = function(object) {
    if (object && typeof object.loadAccounts === 'function' && typeof object.startupReady === 'function') {
      Object.freeze = freeze;
      for (const name of Object.keys(object)) {
        const fn = object[name];
        if (typeof fn !== 'function' || /^on[A-Z]/.test(name)) continue;
        object[name] = function(...args) {
          const record = { method: name, start: performance.now() }; audit.ipc.push(record);
          const result = fn.apply(this, args);
          if (result?.then) return result.then(value => { record.duration=performance.now()-record.start;return value }, error => {record.failed=true;throw error});
          record.duration=performance.now()-record.start;return result;
        };
      }
    }
    return freeze(object);
  };
})();`
const report = { label, runs: [] }
try {
  await send("Page.enable")
  await send("Network.enable")
  await send("Page.bringToFront")
  const added = await send("Page.addScriptToEvaluateOnNewDocument", { source: probe })
  for (let run = 0; run < 3; run++) {
    await send("Network.setCacheDisabled", { cacheDisabled: run === 0 })
    await send("Page.reload", { ignoreCache: run === 0 })
    const ready = await evaluate(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),20000);function check(){if(window.__launcherAudit?.events['app:revealed']){clearTimeout(timer);resolve(window.__launcherAudit)}else setTimeout(check,10)}check()})`)
    const navigation = []
    for (const tab of ["builds", "accounts", "settings", "logs", "stats", "skins", "servers", "home", "builds", "settings", "home"]) {
      navigation.push(await evaluate(`(async () => {
        const tab = ${JSON.stringify(tab)}, button = document.getElementById('sidebar-item-' + tab);
        if (!button) throw new Error('Tab missing: ' + tab);
        const start=performance.now(), ipcStart=window.__launcherAudit.ipc.length;
        button.click();
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Navigation timeout '+tab)),15000);function check(){const root=document.getElementById('launcher-content');if(root?.dataset.page===tab && ![...root.querySelectorAll('[data-component="page-fallback"]')].some(e=>e.getClientRects().length)){requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))}else setTimeout(check,5)}check()});
        return {tab,paintMs:performance.now()-start,ipc:window.__launcherAudit.ipc.slice(ipcStart),dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize};
      })()`))
    }
    await send("HeapProfiler.collectGarbage")
    report.runs.push({ run, cacheDisabled: run === 0, startup: ready.events, navigation,
      final: await evaluate(`({longTasks:window.__launcherAudit.longTasks,heap:performance.memory?.usedJSHeapSize,ipc:window.__launcherAudit.ipc})`) })
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier })
  await send("Network.setCacheDisabled", { cacheDisabled: false })
  const output = path.resolve(".tmp", "performance-audit", label + ".json")
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(output)
} finally {
  socket.close()
}
