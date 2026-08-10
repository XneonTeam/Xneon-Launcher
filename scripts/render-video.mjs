import puppeteer from "puppeteer"
import { spawn } from "child_process"
import { createServer } from "http"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const HTML_PATH = join(ROOT, "motion-advert.html")
const OUTPUT = join(ROOT, "xneon-launcher-advert.mp4")

const FPS = 15
const TOTAL_DURATION = 47
const TOTAL_FRAMES = TOTAL_DURATION * FPS
const BATCH_SIZE = 10

function serveHtml() {
  const html = readFileSync(HTML_PATH, "utf-8")
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(html)
    } else {
      res.writeHead(404)
      res.end("Not found")
    }
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` })
    })
  })
}

async function renderVideo() {
  console.log("Xneon Launcher — Video Render")
  console.log("=".repeat(40))
  console.log(`Resolution: 1920×1080`)
  console.log(`FPS: ${FPS}`)
  console.log(`Duration: ${TOTAL_DURATION}s`)
  console.log(`Frames: ${TOTAL_FRAMES}`)
  console.log(`Output: ${OUTPUT}`)
  console.log("=".repeat(40))

  const { server, url } = await serveHtml()
  console.log(`Serving: ${url}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    defaultViewport: { width: 1920, height: 1080 },
  })

  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "networkidle0" })
  await new Promise((r) => setTimeout(r, 1000))

  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(FPS),
    "-i", "-",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    OUTPUT,
  ])

  let ffmpegErr = ""
  ffmpeg.stderr.on("data", (d) => { ffmpegErr += d })
  ffmpeg.on("close", (code) => {
    if (code !== 0) console.error("FFmpeg error:", ffmpegErr.slice(-300))
  })

  console.log("Rendering frames...")
  const startTime = Date.now()

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const time = frame / FPS
    await page.evaluate((t) => {
      if (window.__renderControl) window.__renderControl(t)
    }, time)

    const buffer = await page.screenshot({
      type: "png",
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    })

    ffmpeg.stdin.write(buffer)

    if (frame % (FPS * 5) === 0 || frame === TOTAL_FRAMES - 1) {
      const pct = ((frame / TOTAL_FRAMES) * 100).toFixed(1)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const eta = frame > 0 ? ((Date.now() - startTime) / frame * (TOTAL_FRAMES - frame) / 1000).toFixed(1) : "?"
      process.stdout.write(`\r  ${frame}/${TOTAL_FRAMES} (${pct}%) — ${elapsed}s elapsed, ETA ${eta}s   `)
    }
  }

  console.log("\nFinishing encoding...")
  ffmpeg.stdin.end()

  await new Promise((resolve) => ffmpeg.on("close", resolve))
  await browser.close()
  server.close()

  const stats = existsSync(OUTPUT) ? (await import("fs")).statSync(OUTPUT) : null
  console.log(`\n✅ Done!`)
  if (stats) console.log(`   ${OUTPUT} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
}

renderVideo().catch((err) => {
  console.error("Render failed:", err)
  process.exit(1)
})
