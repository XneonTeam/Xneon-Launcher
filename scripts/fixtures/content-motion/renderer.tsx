import React from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import { ServersBrowse } from "../../../components/launcher/servers-browse"
import { InstanceModrinth } from "../../../components/launcher/instance/instance-modrinth"
import { InstanceCurseForge } from "../../../components/launcher/instance/instance-curseforge"
import { InstanceFtb } from "../../../components/launcher/instance/instance-ftb"
import "../../../src/index.css"

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const noop = () => {}
const checks: string[] = []
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const shared = {
  source: "curseforge", search: "", cfSearch: "", ftbSearch: "", setSearch: noop, setCfSearch: noop, setFtbSearch: noop,
  results: [], cfResults: [], ftbResults: [], installingKey: null, downloadingSlug: null, cfDownloadingId: null, ftbDownloadingId: null,
  sortBy: "downloads", setSortBy: noop, sortOptions: ["downloads"],
  selectedVersion: "all", setSelectedVersion: noop, versionsLoaded: true, versionOptions: [], selectedModLoader: "all", setSelectedModLoader: noop,
  page: 0, totalPages: 1, onPageChange: noop, onInstall: noop, onDownload: noop, onOpenDetails: noop,
  categories: [], modCategories: [], selectedCategories: [], setModCategories: noop, onApplyCategories: noop,
  gameVersion: "all", setGameVersion: noop, gameVersions: [], loader: "all", setLoader: noop, availableLoaders: [],
}

async function run() {
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  const root = createRoot(document.getElementById("root")!)
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  const cases = [
    [ServersBrowse, "servers-browse-div-1", "servers-browse-toolbar-div-1", "servers-browse-div-2"],
    [InstanceModrinth, "instance-instance-modrinth-div-1", "instance-instance-browse-toolbar-div-1", "instance-instance-modrinth-div-2"],
    [InstanceCurseForge, "instance-instance-curseforge-div-1", "instance-instance-browse-toolbar-div-1", "instance-instance-curseforge-div-2"],
    [InstanceFtb, "instance-instance-ftb-div-1", "instance-instance-ftb-div-2", "instance-instance-ftb-div-4"],
  ] as const
  for (const [Component, parentId, toolbarId, contentId] of cases) {
    const result = { id: "motion-test", slug: "motion-test", projectId: "motion-test", modId: 1, name: "Motion test result", summary: "", downloadCount: 1, source: "modrinth", categories: [] }
    const render = (loading: boolean) => {
      const results = loading ? [] : [result]
      root.render(React.createElement(Component as React.ComponentType<any>, { ...shared, key: parentId, loading, cfLoading: loading, ftbLoading: loading, results, cfResults: results, ftbResults: results }))
    }
    render(true)
    await wait(450)
    const parent = document.querySelector(`[data-ui="${parentId}"]`)!
    const toolbar = document.querySelector(`[data-ui="${toolbarId}"]`)!
    const content = document.querySelector(`[data-ui="${contentId}"]`)!
    assert(getComputedStyle(parent).animationName === "none", `${parentId}: общий контейнер анимируется`)
    assert(getComputedStyle(content).animationName === "none", `${parentId}: контент анимируется до ответа`)
    assert(!content.textContent?.includes(result.name), `${parentId}: результат виден до ответа`)
    const toolbarAnimation = toolbar.getAnimations()[0]
    if (!reduced) assert(!!toolbarAnimation && getComputedStyle(toolbar).animationName !== "none", `${parentId}: панель не появилась сразу с анимацией`)
    render(false)
    await wait(50)
    const loadedContent = document.querySelector(`[data-ui="${contentId}"]`)!
    const animation = getComputedStyle(loadedContent).animationName
    assert(loadedContent.textContent?.includes(result.name), `${parentId}: ответ не появился в списке`)
    if (!reduced) assert(animation !== "none" && loadedContent.getAnimations().length === 1, `${parentId}: после ответа нет отдельной анимации контента`)
    assert(document.querySelector(`[data-ui="${toolbarId}"]`) === toolbar, `${parentId}: панель перемонтируется после ответа`)
    assert(toolbar.getAnimations()[0] === toolbarAnimation, `${parentId}: анимация панели перезапускается после ответа`)
    checks.push(`${parentId}: панель сразу, контент после загрузки, панель не повторяется`)
  }

  let finishProviders!: (providers: { id: string; name: string }[]) => void
  Object.assign(window, { electronAPI: {
    cloudListProviders: () => new Promise(resolve => { finishProviders = resolve }),
    cloudIsConnected: async () => false,
  } })
  const { CloudPage } = await import("../../../components/launcher/cloud")
  root.render(<CloudPage />)
  await wait(450)
  const cloud = document.querySelector('[data-ui="cloud-index-div-7"]')!
  const header = document.querySelector('[data-ui="cloud-index-div-9"]')!
  assert(getComputedStyle(cloud).animationName === "none", "Облако: общий контейнер анимируется")
  assert(!document.querySelector('[data-ui="cloud-index-div-13"]'), "Облако: карточки появились до ответа")
  const headerAnimation = header.getAnimations()[0]
  if (!reduced) assert(!!headerAnimation, "Облако: заголовок не анимируется при входе")
  finishProviders([{ id: "webdav", name: "Motion test cloud" }])
  await wait(50)
  const providers = document.querySelector('[data-ui="cloud-index-div-13"]')!
  assert(providers?.textContent?.includes("Motion test cloud"), "Облако: карточка не появилась после ответа")
  if (!reduced) assert(providers.getAnimations().length === 1, "Облако: нет отдельной анимации карточек")
  assert(document.querySelector('[data-ui="cloud-index-div-9"]') === header && header.getAnimations()[0] === headerAnimation, "Облако: заголовок повторно анимируется после загрузки карточек")
  checks.push("Облако: заголовок сразу, карточки после ответа, заголовок не повторяется")
}
run().then(() => Object.assign(window, { __themeReport: { passed: true, checks } })).catch(error => Object.assign(window, { __themeReport: { passed: false, checks, error: String(error.stack || error) } }))
