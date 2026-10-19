const { app, BrowserWindow } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const [page, report, profile] = process.argv.slice(2)
app.setPath("userData", profile)
const timeout = setTimeout(() => { fs.writeFileSync(report, JSON.stringify({ passed: false, error: "Theme rendering timeout" })); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(page)
  for (;;) {
    const result = await win.webContents.executeJavaScript("window.__themeReport")
    if (result) {
      fs.writeFileSync(report, JSON.stringify(result, null, 2))
      clearTimeout(timeout)
      app.exit(result.passed ? 0 : 1)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}).catch(error => { fs.writeFileSync(report, JSON.stringify({ passed: false, error: String(error.stack || error) })); app.exit(1) })
