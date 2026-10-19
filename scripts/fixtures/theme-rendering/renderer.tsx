import React from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/plus-jakarta-sans/latin-400.css"
import "../../../src/index.css"
import videoSource from "./background.webm?url"
import fontSource from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2?url"
import { ThemeRuntime } from "../../../components/launcher/settings/theme-runtime"
import { ThemeBackgroundLayer } from "../../../components/launcher/theme-background-layer"
import { CloudProviderCard } from "../../../components/launcher/cloud/cloud-provider-card"
import { ThemeCloudUpload } from "../../../components/launcher/settings/theme-cloud-upload"
import { SkinGrid } from "../../../components/launcher/skins/skin-grid"
import { SKIN_GRID_CLASS } from "../../../components/launcher/skins/skin-grid-layout"
import { applyTheme, createCustomTheme, parseThemes, serializeThemes } from "../../../components/launcher/settings/theme-model"

const theme = createCustomTheme("Проверка")
const reports: string[] = []
const delay = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))
const element = (id: string) => document.getElementById(id)!
const computed = (id: string) => getComputedStyle(element(id))
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); reports.push(message) }
function Fixture() {
  return <><ThemeRuntime theme={theme} />
    <div id="launcher-root" className="relative isolate min-h-screen p-6">
      <header id="launcher-titlebar" className="bg-sidebar/95 p-3">Xneon Launcher</header>
      <aside id="launcher-sidebar" className="bg-sidebar/95 p-3">Настройки</aside>
      <article id="card" className="bg-card rounded-xl p-6"><p id="text">Шрифт темы / Theme font — WWW iii 0123456789</p>
        <p id="sans" className="font-sans">Утилита font-sans</p><button id="button">Кнопка</button><input id="input" defaultValue="Поле ввода" /></article>
      <div id="cloud-cards" className="grid grid-cols-3 gap-2">{["google-drive", "onedrive", "dropbox", "yandex-disk", "webdav", "s3"].map(id => <CloudProviderCard key={id} id={id} name={id} onConnect={() => {}} connecting={false} />)}</div>
      <button id="danger" className="bg-destructive text-destructive-foreground">Удалить</button>
      <span id="success" className="text-success">Готово</span><span id="warning" className="text-warning">Предупреждение</span><span id="info" className="text-info">Информация</span>
      <ThemeBackgroundLayer theme={theme} />
    </div></>
}
createRoot(element("root")).render(<Fixture />)
async function run() {
  await delay()
  applyTheme({ ...theme, font: { family: "serif", size: 18 } })
  await delay()
  check(computed("text").fontFamily.startsWith("serif"), "Гарнитура применяется к обычному тексту")
  check(computed("sans").fontFamily.startsWith("serif"), "font-sans использует гарнитуру темы")
  check(computed("button").fontFamily.startsWith("serif") && computed("input").fontFamily.startsWith("serif"), "Кнопки и поля наследуют шрифт")
  check(getComputedStyle(document.documentElement).fontSize === "18px", "Размер текста применяется")
  applyTheme({ ...theme, font: { family: "monospace", size: 16 } })
  check(computed("text").fontFamily.startsWith("monospace"), "Шрифт меняется повторно без перезапуска")
  applyTheme({ ...theme, font: { family: "XneonThemeFont", source: fontSource } })
  for (let i = 0; i < 100 && ![...document.fonts].some(font => font.family === "XneonThemeFont" && font.status === "loaded"); i++) await delay(25)
  check([...document.fonts].some(font => font.family === "XneonThemeFont" && font.status === "loaded"), "Шрифт из файла загружается через ThemeRuntime")
  check(computed("text").fontFamily.includes("XneonThemeFont"), "Загруженная гарнитура используется в тексте")
  let eventFont = ""
  const listener = () => { eventFont = computed("text").fontFamily }
  window.addEventListener("theme:applied", listener)
  applyTheme({ ...theme, font: { family: "system-ui" } })
  window.removeEventListener("theme:applied", listener)
  check(eventFont.startsWith("system-ui"), "Событие темы приходит после применения CSS")
  applyTheme({ ...theme, appearance: { titlebar: "#123456", error: "#aa1122", warning: "#bb8811", info: "#2266bb", success: "#118855", blurTitlebar: 9, blurSidebar: 12, blurCard: 7, radius: 22 } })
  check(computed("launcher-titlebar").backdropFilter === "blur(9px)", "Размытие шапки применяется")
  check(computed("launcher-sidebar").backdropFilter === "blur(12px)", "Размытие боковой панели применяется")
  check(computed("card").backdropFilter === "blur(7px)" && computed("card").borderRadius === "22px", "Размытие и скругление карточек применяются")
  check(computed("launcher-sidebar").backgroundColor.includes("0.75") && computed("card").backgroundColor.includes("0.8"), "Размываемые поверхности полупрозрачны")
  check(getComputedStyle(document.documentElement).getPropertyValue("--destructive").trim() === "#aa1122", "Цвет ошибок применяется")
  check(computed("danger").backgroundColor === "rgb(170, 17, 34)" && computed("danger").color === "rgb(255, 255, 255)", "Опасные действия используют цвет ошибки и контрастный текст")
  check(computed("success").color === "rgb(17, 136, 85)" && computed("warning").color === "rgb(187, 136, 17)" && computed("info").color === "rgb(34, 102, 187)", "Статусы используют отдельно выбранные цвета состояний")
  applyTheme({ ...theme, palette: { ...theme.palette, primary: "#7643bc" }, appearance: { colorMode: "light", lightPalette: { ...theme.palette, background: "#ffffff", primary: "#7643bc" }, error: "#ffffff" } })
  check(computed("danger").color === "rgb(0, 0, 0)", "Светлая кнопка удаления получает тёмный текст")
  const providerIcons = [...document.querySelectorAll("#cloud-cards svg")]
  check(providerIcons.length === 6 && providerIcons.every(icon => getComputedStyle(icon).color === "rgb(118, 67, 188)"), "Все облачные провайдеры следуют акценту светлой темы")
  const background = { kind: "halo" as const, source: "", opacity: 0, blur: 4, dim: 0.4 }
  const saved = parseThemes(serializeThemes([{ ...theme, background }]))[0]
  check(saved.background?.opacity === 0, "Нулевая прозрачность сохраняется")
  applyTheme(saved)
  await delay()
  check(!!document.querySelector(".theme-halo"), "Анимированный фон появляется")
  check(getComputedStyle(document.querySelector("#theme-background > div")!).opacity === "0", "Нулевая прозрачность скрывает фон полностью")
  const canvas = document.createElement("canvas")
  canvas.width = 32; canvas.height = 32
  canvas.getContext("2d")!.fillRect(0, 0, 32, 32)
  applyTheme({ ...theme, background: { kind: "image", source: canvas.toDataURL(), fit: "contain", opacity: 0.6, blur: 5, dim: 0.3 } })
  await delay()
  const image = document.querySelector("#theme-background img") as HTMLImageElement
  await image.decode()
  check(image.naturalWidth === 32 && getComputedStyle(image).objectFit === "contain", "Изображение загружается с выбранным масштабированием")
  const imageLayer = image.parentElement!
  check(getComputedStyle(imageLayer).filter === "blur(5px)" && getComputedStyle(imageLayer).opacity === "0.6", "Размытие и прозрачность изображения применяются")
  check(getComputedStyle(imageLayer.nextElementSibling!).backgroundColor === "rgba(0, 0, 0, 0.3)", "Затемнение фона применяется")
  check(getComputedStyle(imageLayer).transform === "none", "Режим contain не обрезает фон дополнительным масштабированием")
  applyTheme({ ...theme, background: { kind: "video", source: videoSource, fit: "contain", volume: 0.42 } })
  await delay()
  const video = document.querySelector("#theme-background video") as HTMLVideoElement
  if (!video) throw new Error("Video background did not appear")
  for (let i = 0; i < 100 && video.readyState < 2 && !video.error; i++) await delay(20)
  check(video.readyState >= 2, "Видеофон загружает настоящий WebM")
  check(video.volume === 0.42 && getComputedStyle(video).objectFit === "contain", "Громкость и масштабирование видео применяются")
  Object.defineProperty(document, "hidden", { configurable: true, value: true })
  document.dispatchEvent(new Event("visibilitychange"))
  await delay()
  check(video.paused, "Видеофон при скрытом окне стоит на паузе")
  delete (document as any).hidden
  document.dispatchEvent(new Event("visibilitychange"))
  await delay()
  check(!video.paused, "Видеофон продолжает воспроизведение после возвращения")
  applyTheme({ ...theme, background: { kind: "particles", source: "", particleStyle: "snow" } })
  await delay()
  check(!!document.querySelector("#theme-background canvas"), "Частицы создают отдельный canvas")
  applyTheme({ ...theme, appearance: { colorMode: "light", lightPalette: { background: "#eeeeee" }, darkPalette: { background: "#111111" } } })
  check(getComputedStyle(document.body).backgroundColor === "rgb(238, 238, 238)", "Светлая палитра применяется")
  applyTheme({ ...theme, appearance: { colorMode: "dark", darkPalette: { background: "#111111" } } })
  check(getComputedStyle(document.body).backgroundColor === "rgb(17, 17, 17)", "Тёмная палитра применяется")
  applyTheme({ ...theme, css: ":root { --font-sans: serif; } #card { border-radius: 3px; }" })
  check(computed("text").fontFamily === "serif" && computed("card").borderRadius === "3px", "Пользовательский CSS переопределяет тему")
  applyTheme({ ...theme, cssEnabled: false, css: "#card { border-radius: 3px; }" })
  check(computed("card").borderRadius !== "3px", "Отключение CSS снимает его эффекты")
  applyTheme(theme)
  await delay()
  check(computed("text").fontFamily.includes("Plus Jakarta Sans"), "Смена темы восстанавливает базовый шрифт")
  check(computed("card").backdropFilter === "none", "Смена темы снимает размытие")
  check(!document.getElementById("theme-background"), "Смена темы убирает фон")
  check(![...document.fonts].some(font => font.family === "XneonThemeFont"), "Неиспользуемый файл шрифта выгружается")
  let uploadProgress: ((value: any) => void) | undefined
  let unsubscribed = false, uploaded = ""
  const mockApi = {
    isMinecraftRunning: async () => false,
    setSetting: async () => {},
    cloudListProviders: async () => [{ id: "google-drive", name: "Google Drive" }, { id: "s3", name: "S3" }],
    cloudIsConnected: async (id: string) => id === "google-drive",
    onCloudUploadProgress: (callback: (value: any) => void) => { uploadProgress = callback; return () => { unsubscribed = true } },
    cloudUploadTheme: async (provider: string, id: string, uploadId: string) => { uploaded = `${provider}:${id}`; uploadProgress?.({ id: uploadId, percent: 50, stage: "upload" }); await delay(100); return { success: true } },
  }
  ;(window as any).electronAPI = mockApi
  const uploadHost = document.createElement("div"); document.body.appendChild(uploadHost)
  let uploadRoot = createRoot(uploadHost)
  uploadRoot.render(<ThemeCloudUpload theme={theme} onClose={() => {}} />)
  await delay(80)
  let dialog = document.querySelector('[data-window="theme-cloud-upload"]')!
  check(dialog.querySelector('[data-slot="select-trigger"]')?.textContent?.includes("Google Drive"), "Выбор облака показывает подключённого провайдера")
  ;(dialog.querySelector("footer button:last-child") as HTMLButtonElement).click()
  await delay()
  check(dialog.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "50", "Диалог показывает реальный прогресс облачной загрузки")
  await delay(100)
  check(uploaded === `google-drive:${theme.id}` && dialog.textContent?.includes("themeCloud.done"), "Диалог отправляет ID темы и сообщает об успехе")
  uploadRoot.unmount()
  check(unsubscribed, "Закрытие диалога снимает подписку на прогресс")
  mockApi.cloudIsConnected = async () => false
  uploadRoot = createRoot(uploadHost)
  uploadRoot.render(<ThemeCloudUpload theme={theme} onClose={() => {}} />)
  await delay(80)
  dialog = document.querySelector('[data-window="theme-cloud-upload"]')!
  check((dialog.querySelector("footer button:last-child") as HTMLButtonElement).disabled && dialog.textContent?.includes("themeCloud.noProviders"), "Без подключённого облака загрузка недоступна и есть переход к подключению")
  uploadRoot.unmount(); uploadHost.remove(); delete (window as any).electronAPI
  const gridHost = document.createElement("div"); document.body.appendChild(gridHost)
  const gridRoot = createRoot(gridHost)
  const noop = () => {}
  gridRoot.render(<><SkinGrid skins={[]} selectedId={null} equippedId={null} loading={false} dragOver={false} capes={[]} onSelect={noop} onEdit={noop} onDelete={noop} onAddNew={noop} onDragOver={noop} onDragLeave={noop} onDrop={noop} /><div id="catalog-layout" className={SKIN_GRID_CLASS}>{Array.from({ length: 15 }, (_, index) => <div key={index} className="aspect-[31/40] w-full" />)}</div></>)
  await delay()
  const favoriteGrid = gridHost.querySelector('[data-component="skin-grid"]') as HTMLElement
  const catalogGrid = element("catalog-layout")
  for (const grid of [favoriteGrid, catalogGrid]) {
    const widths: number[] = [], columns: number[] = []
    for (const width of [600, 1400, 2200]) {
      gridHost.style.width = `${width}px`
      widths.push(grid.firstElementChild!.getBoundingClientRect().width)
      columns.push(getComputedStyle(grid).gridTemplateColumns.split(" ").length)
    }
    check(widths.every(width => Math.abs(width - 180) < 1) && columns.join(",") === "3,7,11", "Сетка скинов сохраняет ширину карточки и добавляет колонки при расширении")
    gridHost.style.width = "150px"
    check(grid.firstElementChild!.getBoundingClientRect().width === 150 && grid.scrollWidth === 150, "Узкая сетка скинов помещается без горизонтального переполнения")
  }
  gridRoot.unmount(); gridHost.remove()
  return reports
}
run().then(checks => { (window as any).__themeReport = { passed: true, checks } }).catch(error => { (window as any).__themeReport = { passed: false, checks: reports, error: String(error.stack || error) } })
