import { memo, useCallback, useState, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconInfoCircle, IconSettings, IconPuzzle, IconPhoto, IconSparkles, IconMap, IconCamera, IconServer, IconLock } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { LoaderIcon, loaderLabel } from "./loader-icon"
import { EntityIcon } from "./entity-icon"
import { matchesBuildVersion, pickCompatibleVersion } from "./utils"
import { updateCachedBuildContent } from "./use-builds"
import { InstanceContentTab } from "./instance-content-tab"
import { InstanceDetailGeneral } from "./instance-detail-general"
import { InstanceBuildSettings } from "./instance-build-settings"
import { InstanceWorldsTab } from "./instance-worlds-tab"
import { InstanceScreenshotsTab } from "./instance-screenshots-tab"
import { InstanceServersTab } from "./instance-servers-tab"
import { InstanceModal } from "./instance-modal"
import { ActionConfirmDialog } from "./action-confirm-dialog"
import { DepConfirmDialog } from "@/components/launcher/dep-confirm-dialog"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import type { SelectedModCategory } from "./use-mod-search"
import type {
  Build,
  BuildMod,
  DetailTab,
  ModSearchResult,
  Source,
  SearchSource,
  ModSort,
  ModalTab,
  ModVersion,
  ModDetails,
  ModDependency,
} from "./types"
import type { ModCategory } from "@xnlc/types"

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

/** Одна зависимость в плане установки: что за мод и какая именно версия пойдёт. */
interface DepPlanItem {
  dep: ModDependency
  /** Версия, которую поставим (или которую требует мод, если API её закрепил). */
  version?: ModVersion
  /** Версию задал сам мод (versionId в API) — значит нужна именно она. */
  pinned: boolean
}

/** Ожидание ответа пользователя: нужны ли зависимости (null — отказ). */
interface DepConfirmState {
  modName: string
  modIcon?: string
  source: "modrinth" | "curseforge"
  items: DepPlanItem[]
  /** Разрешение промиса: с планом — ставим, с null — отказ. */
  resolve: (items: DepPlanItem[] | null) => void
}

interface InstanceDetailProps {
  activeBuild: Build
  /** Тип проекта, открытого в окне «Подробнее» — для ссылки на страницу площадки. */
  detailsKind?: "mod" | "resourcepack" | "shader" | "modpack" | "datapack" | "plugin"
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  goToMyBuilds: () => void
  updateBuild: (id: string, fields: Partial<Build>) => void
  renameBuild: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
  /** Перемещение сборки в корзину — кнопка на вкладке «Общее». */
  onTrash: (id: string) => Promise<boolean>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  modSearch: string
  setModSearch: (value: string) => void
  modSource: SearchSource
  setModSource: (value: SearchSource) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modCategories: SelectedModCategory[]
  setModCategories: (value: SelectedModCategory[]) => void
  categories: ModCategory[]
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  addLocalModToBuild: (buildId: string, file: File) => void
  addLocalContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", file: File) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  reloadBuilds: () => Promise<void>
  modLoading: boolean
  modTotalHits: number
  modTotalPages: number
  modPage: number
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  isInstalledFn: (project: ModSearchResult) => boolean
  openProjectModal: (item: ModSearchResult, kind?: "mod" | "resourcepack" | "shader" | "modpack" | "datapack" | "plugin") => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void | Promise<boolean>
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  versionsFallback?: "none" | "otherMc" | "otherLoader" | "empty"
  versionsLoaderFiltered?: boolean
  onShowAllVersions?: () => void
  allVersionsCount?: number
  closeModal: () => void
}

export const InstanceDetail = memo(function InstanceDetail(props: InstanceDetailProps) {
  const {
    activeBuild,
    detailTab,
    setDetailTab,
  goToMyBuilds,
  updateBuild,
  renameBuild,
  onTrash,
  fileInputRef,
    detailsKind,
    modSearch,
    setModSearch,
    modSource,
    setModSource,
    modSortBy,
    setModSortBy,
    modCategories,
    setModCategories,
    categories,
    modFileInputRef,
    addLocalModToBuild,
    addLocalContentToBuild,
    removeContentFromBuild,
    reloadBuilds,
    modLoading,
    modTotalHits,
    modTotalPages,
    modPage,
    setModPage,
    displayResults,
    isInstalledFn,
    openProjectModal,
    installingModSlug,
    setInstallingModSlug,
    addModToBuild,
    addContentToBuild,
    setBuilds,
    toggleItemEnabled,
    updateItemVersion,
    selectedDetails,
    modalTab,
    setModalTab,
    loadingModal,
    displayedModalVersions,
    versionsFallback,
    versionsLoaderFiltered,
    onShowAllVersions,
    allVersionsCount,
    closeModal,
  } = props

  const [depConfirm, setDepConfirm] = useState<DepConfirmState | null>(null)

  const { t } = useTranslation()
  const { beginContentInstall, updateContentInstall, endContentInstall } = useActivityCenter()
  const buildHasImage = !!activeBuild.icon
  const isVanilla = activeBuild.modLoader === "vanilla"

  const isLocked = Boolean(
    (activeBuild.source === "modrinth" || activeBuild.source === "curseforge") &&
    activeBuild.locked !== false
  )
  const [lockedTargetTab, setLockedTargetTab] = useState<DetailTab | null>(null)

  useEffect(() => {
    if (isLocked && (detailTab === "mods" || detailTab === "resourcepacks" || detailTab === "shaders")) {
      setDetailTab("general")
    }
  }, [isLocked, detailTab, setDetailTab])

  const handleTabClick = (tab: DetailTab) => {
    if (isLocked && (tab === "mods" || tab === "resourcepacks" || tab === "shaders")) {
      setLockedTargetTab(tab)
      return
    }
    setDetailTab(tab)
  }

  const handleUploadModFile = useCallback((file: File) => addLocalModToBuild(activeBuild.id, file), [activeBuild.id, addLocalModToBuild])
  const handleUploadResourcepackFile = useCallback((file: File) => addLocalContentToBuild(activeBuild.id, "resourcepacks", file), [activeBuild.id, addLocalContentToBuild])
  const handleUploadShaderFile = useCallback((file: File) => addLocalContentToBuild(activeBuild.id, "shaders", file), [activeBuild.id, addLocalContentToBuild])

  const isInstalledBuildMod = useCallback((installedMod: BuildMod, source: "modrinth" | "curseforge", projectId?: string, modId?: number, slug?: string) => {
    if (source === "modrinth" && projectId && installedMod.source === "modrinth" && installedMod.projectId === projectId) {
      return true
    }

    if (source === "curseforge" && typeof modId === "number" && installedMod.source === "curseforge" && installedMod.modId === modId) {
      return true
    }

    const normalizedSlug = normalizeContentIdentity(slug)
    const installedSlug = normalizeContentIdentity(installedMod.slug)
    const installedName = normalizeContentIdentity(installedMod.name)
    if (!normalizedSlug || (!installedSlug && !installedName)) return false

    // Exact identity only. Partial matching is unsafe here: "sodium" would
    // otherwise be treated as installed because of "sodium-extra" /
    // "reese's sodium options" being present in the build.
    return installedSlug === normalizedSlug || installedName === normalizedSlug
  }, [])

  /**
   * Оставляет только те зависимости, у которых есть версия под эту сборку
   * (версия Minecraft + загрузчик). Одни и те же проекты часто публикуют файлы
   * под разные загрузчики, поэтому на NeoForge-сборке предлагалось поставить
   * Fabric API — проверка по версиям проекта это отсекает.
   */
  const filterDepsForBuild = useCallback(async (deps: ModDependency[], source: Source): Promise<ModDependency[]> => {
    if (source === "ftb" || deps.length === 0) return deps

    const checked = await Promise.all(deps.map(async (dep) => {
      if (!dep.projectId) return dep
      try {
        if (source === "modrinth") {
          const versions = await window.electronAPI?.modsModrinthVersions(dep.projectId) ?? []
          return versions.some(version => matchesBuildVersion(version, activeBuild)) ? dep : null
        }
        const modId = Number.parseInt(dep.projectId, 10)
        if (!Number.isInteger(modId)) return dep
        const details = await window.electronAPI?.modsCurseforgeDetails(modId)
        return (details?.versions ?? []).some(version => matchesBuildVersion(version, activeBuild)) ? dep : null
      } catch {
        // Данные о проекте недоступны — не прячем зависимость от пользователя.
        return dep
      }
    }))

    return checked.filter((dep): dep is ModDependency => Boolean(dep))
  }, [activeBuild])

  const doDownloadMod = useCallback(async (
    fileUrl: string,
    fileName: string,
    metadata?: {
      name?: string
      description?: string
      iconUrl?: string
      version?: string
      matchSlug?: string
      source?: "local" | "modrinth" | "curseforge"
      projectId?: string
      modId?: number
    },
  ) => {
    const buildName = activeBuild.name
    if (!buildName) return
    const saved = await window.electronAPI?.saveModToIntent(buildName, fileUrl, fileName)
    if (saved) {
      setBuilds(prev => prev.map(build => {
        if (build.id !== activeBuild.id) return build

        const matchSlug = metadata?.matchSlug?.toLowerCase()
        const matchName = metadata?.name?.toLowerCase()
        const existingIndex = build.mods.findIndex(mod => {
          const modSlug = mod.slug.toLowerCase()
          const modName = mod.name.toLowerCase()
          if (metadata?.source === "modrinth" && metadata.projectId && mod.source === "modrinth" && mod.projectId === metadata.projectId) {
            return true
          }
          if (metadata?.source === "curseforge" && typeof metadata.modId === "number" && mod.source === "curseforge" && mod.modId === metadata.modId) {
            return true
          }
          return modSlug === fileName.toLowerCase()
            || (matchSlug ? modSlug === matchSlug : false)
            || (matchName ? modName === matchName : false)
        })

        const nextEntry = {
          id: existingIndex >= 0 ? build.mods[existingIndex].id : crypto.randomUUID(),
          slug: fileName,
          name: metadata?.name || fileName.replace(/\.jar$|\.zip$|\.litemod$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          description: metadata?.description || (existingIndex >= 0 ? build.mods[existingIndex].description : ""),
          icon_url: metadata?.iconUrl || (existingIndex >= 0 ? build.mods[existingIndex].icon_url : undefined),
          version: metadata?.version || (existingIndex >= 0 ? build.mods[existingIndex].version : "local"),
          source: metadata?.source || (existingIndex >= 0 ? build.mods[existingIndex].source : "local"),
          projectId: metadata?.projectId || (existingIndex >= 0 ? build.mods[existingIndex].projectId : undefined),
          modId: metadata?.modId ?? (existingIndex >= 0 ? build.mods[existingIndex].modId : undefined),
        }

        const mods = existingIndex >= 0
          ? build.mods.map((mod, index) => index === existingIndex ? nextEntry : mod)
          : [...build.mods, nextEntry]

        const nextInstalledMods = {
          ...(build.installedMods ?? {}),
          [fileName]: saved,
        }

        updateCachedBuildContent(activeBuild.id, {
          mods,
          resourcepacks: build.resourcepacks,
          shaders: build.shaders,
          installedMods: nextInstalledMods,
        })

        return {
          ...build,
          installedMods: nextInstalledMods,
          mods,
        }
      }))
      await reloadBuilds()
    }
  }, [activeBuild.id, activeBuild.name, reloadBuilds, setBuilds])

  /** Подбирает версию зависимости: сначала ту, что требует API, иначе совместимую. */
  const resolveDepVersion = useCallback(async (dep: ModDependency, source: string): Promise<ModVersion | undefined> => {
    try {
      if (source === "modrinth") {
        const versions = await window.electronAPI?.modsModrinthVersions(dep.projectId) ?? []
        // versionId от API — точное требование мода, его и берём.
        return (dep.versionId ? versions.find(v => v.id === dep.versionId) : undefined)
          ?? pickCompatibleVersion(versions, activeBuild)
      }
      const depModId = parseInt(dep.projectId)
      if (isNaN(depModId)) return undefined
      const versions = (await window.electronAPI?.modsCurseforgeDetails(depModId))?.versions ?? []
      return (dep.versionId ? versions.find(v => v.id === dep.versionId) : undefined)
        ?? pickCompatibleVersion(versions, activeBuild)
    } catch {
      return undefined
    }
  }, [activeBuild])

  const doDownloadDep = useCallback(async (dep: ModDependency, source: string, preResolved?: ModVersion) => {
    if (dep.dependencyType === "embedded" || !dep.projectId) return
    try {
      // Версию подобрали заранее (её же показали в окне подтверждения) — качаем ровно её.
      const version = preResolved ?? await resolveDepVersion(dep, source)
      if (!version) return
      if (source === "modrinth") {
        const file = version.files?.[0]
        if (!file?.url) return
        await doDownloadMod(
          file.url,
          file.filename || version.fileName || `${dep.projectId}.jar`,
          {
            name: dep.name,
            iconUrl: dep.iconUrl,
            version: version.name || version.id,
            source: "modrinth",
            projectId: dep.projectId,
            matchSlug: dep.slug || dep.projectId,
          },
        )
        return
      }
      const depModId = parseInt(dep.projectId)
      if (isNaN(depModId)) return
      const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), depModId)
      if (!url) return
      const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || `${dep.projectId}.jar`
      await doDownloadMod(url, fileName, {
        name: dep.name,
        iconUrl: dep.iconUrl,
        version: version.name || version.id,
        source: "curseforge",
        projectId: dep.projectId,
        modId: depModId,
        matchSlug: dep.slug || dep.projectId,
      })
    } catch { /* skip failed dep */ }
  }, [doDownloadMod, resolveDepVersion])

  /** План установки зависимостей: что именно поставим — показываем в окне подтверждения. */
  const planDeps = useCallback(async (deps: ModDependency[], source: "modrinth" | "curseforge"): Promise<DepPlanItem[]> => {
    const items: DepPlanItem[] = []
    for (const dep of deps) {
      const version = await resolveDepVersion(dep, source)
      // У зависимостей из API обычно нет имени и иконки — в окне подтверждения
      // был виден только slug («iris»). Подтягиваем проект.
      let resolved = dep
      if (!dep.name || !dep.iconUrl) {
        try {
          if (source === "modrinth") {
            const details = await window.electronAPI?.modsModrinthDetails(dep.slug || dep.projectId)
            if (details) resolved = { ...dep, name: dep.name || details.name, iconUrl: dep.iconUrl || details.iconUrl }
          } else {
            const modId = Number.parseInt(dep.projectId, 10)
            const details = Number.isInteger(modId) ? await window.electronAPI?.modsCurseforgeDetails(modId) : null
            if (details) resolved = { ...dep, name: dep.name || details.name, iconUrl: dep.iconUrl || details.iconUrl }
          }
        } catch { /* нет данных о проекте — показываем как есть */ }
      }
      items.push({
        dep: resolved,
        version,
        // Требование API совпало с найденной версией — значит версия обязательная.
        pinned: Boolean(dep.versionId && version?.id === dep.versionId),
      })
    }
    return items
  }, [resolveDepVersion])

  const installVersionWithDeps = useCallback(async (
    version: ModVersion,
    source: Source,
    selectedDeps: ModDependency[],
    overrideMetadata?: { name?: string; description?: string; iconUrl?: string; projectId?: string; modId?: number },
    onPhase?: (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => void,
    depVersions?: Map<string, ModVersion>,
  ) => {
    if (source === "ftb") {
      return
    }
    onPhase?.("downloading")
    const meta = {
      name: overrideMetadata?.name || selectedDetails?.name,
      description: overrideMetadata?.description || selectedDetails?.summary,
      iconUrl: overrideMetadata?.iconUrl || selectedDetails?.iconUrl,
    }
    if (source === "modrinth") {
      const file = version.files?.[0]
      if (file?.url) {
        await doDownloadMod(file.url, file.filename || version.fileName || `${version.id}.jar`, {
          ...meta,
          version: version.name || version.id,
          source: "modrinth",
          projectId: overrideMetadata?.projectId || selectedDetails?.projectId || selectedDetails?.id,
          matchSlug: selectedDetails?.slug || overrideMetadata?.projectId,
        })
      }
    } else {
      const modId = overrideMetadata?.modId || selectedDetails?.modId
      if (modId) {
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), modId)
        if (url) {
          const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || `mod-${version.id}.jar`
          await doDownloadMod(url, fileName, {
            ...meta,
            version: version.name || version.id,
            source: "curseforge",
            projectId: overrideMetadata?.projectId || selectedDetails?.projectId,
            modId,
            matchSlug: selectedDetails?.slug || String(modId),
          })
        }
      }
    }

    // Зависимости качаются по одной и тоже занимают время — подписываем этот этап.
    if (selectedDeps.length > 0) onPhase?.("deps")
    for (const dep of selectedDeps) {
      // Ставим ровно те версии, которые показали в окне подтверждения.
      await doDownloadDep(dep, source, depVersions?.get(dep.projectId))
    }
    onPhase?.(null)
  }, [selectedDetails, doDownloadMod, doDownloadDep])

  /**
   * Обязательные зависимости версии. CurseForge и Modrinth заполняют их не всегда:
   * у jei под 26.2 оба API отдают пустой список, из-за чего мод падал с
   * «Incompatible mods found». Когда API молчит — читаем метаданные самого jar
   * (fabric.mod.json / quilt.mod.json / mods.toml), там зависимость объявлена всегда.
   */
  const resolveRequiredDeps = useCallback(async (
    version: ModVersion,
    source: "modrinth" | "curseforge",
    modId?: number,
  ): Promise<ModDependency[]> => {
    const declared = version.dependencies ?? []
    if (declared.some(dep => dep.dependencyType === "required")) {
      return await window.electronAPI?.modsResolveDependencies(version, source) ?? declared
    }

    const url = source === "modrinth"
      ? version.files?.[0]?.url
      : modId ? await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), modId) : null
    if (!url) return declared

    const inspected = await window.electronAPI?.modsInspectJarDependencies(url, source)
    const fromJar = inspected?.dependencies ?? []
    if (fromJar.length > 0) {
      console.info(`[deps] зависимости «${inspected?.modId ?? "mod"}» взяты из jar: ${fromJar.map(dep => dep.slug || dep.projectId).join(", ")}`)
      return fromJar
    }
    return declared
  }, [])

  /**
   * Спрашиваем про зависимости и ждём ответа в том же промисе: пока окно открыто,
   * карточка установки остаётся в состоянии «идёт», а по согласию сразу продолжается
   * установка. Отказ — ничего не ставим.
   */
  const askAboutDeps = useCallback((
    modName: string,
    modIcon: string | undefined,
    source: "modrinth" | "curseforge",
    items: DepPlanItem[],
  ): Promise<DepPlanItem[] | null> => {
    return new Promise<DepPlanItem[] | null>((resolve) => {
      setDepConfirm({ modName, modIcon, source, items, resolve })
    })
  }, [])

  const answerDeps = useCallback((items: DepPlanItem[] | null) => {
    setDepConfirm(prev => {
      prev?.resolve(items)
      return null
    })
  }, [])

  /**
   * Требования шейдера. Modrinth не кладёт их в `dependencies` — требование
   * лежит в `loaders` файла (`["iris","optifine"]`), поэтому на сборке без Iris
   * (и не на OptiFine) предлагаем его поставить.
   */
  /** Нужен ли Iris этой версии шейдера на этой сборке. */
  const shaderNeedsIris = useCallback((version: ModVersion, build: Build): boolean => {
    // OptiFine-сборка сама рисует шейдеры, Iris там не нужен.
    if (build.modLoader === "optifine") return false
    if (build.mods.some(installed => isInstalledBuildMod(installed, "modrinth", "iris", undefined, "iris"))) return false

    const loaders = (version.loaders ?? []).map(loader => loader.toLowerCase())
    const gameVersions = String(version.gameVersion ?? "").toLowerCase()
    // Modrinth отдаёт требование в loaders, CurseForge — иногда в gameVersions
    // («Iris», «OptiFine»). Если данных нет вовсе, на не-OptiFine сборке Iris всё
    // равно нужен: без него шейдеры в игре не включатся.
    return loaders.includes("iris")
      || gameVersions.includes("iris")
      || (loaders.length === 0 && !gameVersions.includes("optifine"))
  }, [isInstalledBuildMod])

  /** Зависимость Iris под нужный источник: у Modrinth это slug, у CurseForge — modId. */
  const buildIrisDep = useCallback(async (source: "modrinth" | "curseforge"): Promise<ModDependency | null> => {
    if (source === "modrinth") {
      return { projectId: "iris", dependencyType: "required", slug: "iris", name: "Iris Shaders" }
    }
    try {
      const found = await window.electronAPI?.modsCurseforgeSearch("iris shaders", undefined, activeBuild.version, "fabric", undefined, 0)
      const hit = (found?.results ?? []).find(item =>
        /^iris/i.test(String(item.slug ?? "")) || /^iris\s*shaders$/i.test(String(item.name ?? "").trim()))
      if (hit?.modId) {
        return { projectId: String(hit.modId), dependencyType: "required", slug: hit.slug, name: hit.name, iconUrl: hit.iconUrl }
      }
    } catch { /* данных нет — зависимость не добавляем */ }
    return null
  }, [activeBuild.version])

  /** Установка ресурспака/шейдера: сначала зависимости (у шейдеров — Iris), потом сам файл. */
  const installContentToBuild = useCallback(async (
    mod: ModSearchResult,
    type: "resourcepacks" | "shaders",
    onPhase?: (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => void,
  ) => {
    const source = mod.source as Source
    onPhase?.("resolving")

    if (type === "shaders" && source !== "ftb") {
      // Требования шейдеров берём из двух мест: CF отдаёт их в dependencies
      // файла, Modrinth — в loaders (`iris`/`optifine`). Jar не читаем: это zip.
      let version: ModVersion | undefined
      if (source === "modrinth") {
        // У шейдеров в loaders стоит iris/optifine, а не загрузчик сборки, поэтому
        // совпадение по загрузчику не проверяем — иначе версия не находится вовсе.
        version = pickCompatibleVersion(await window.electronAPI?.modsModrinthVersions(mod.projectId ?? mod.slug), activeBuild, false)
      } else if (source === "curseforge" && mod.modId) {
        const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
        version = pickCompatibleVersion(details?.versions ?? [], activeBuild, false)
      }

      if (version) {
        const declared = (version.dependencies ?? []).filter(dep => dep.dependencyType === "required")
        const irisDep = shaderNeedsIris(version, activeBuild) ? await buildIrisDep(source) : null
        const required = [...declared, ...(irisDep ? [irisDep] : [])]
        const missing = required.filter(dep =>
          !activeBuild.mods.some(installed => isInstalledBuildMod(installed, source, dep.projectId, undefined, dep.slug)))
        const installable = await filterDepsForBuild(missing, source)
        if (installable.length > 0) {
          onPhase?.("confirm")
          const plan = await planDeps(installable, source)
          const approved = await askAboutDeps(mod.name, mod.iconUrl, source, plan)
          if (approved) {
            onPhase?.("deps")
            for (const item of approved) {
              await doDownloadDep(item.dep, source, item.version)
            }
          }
        }
      }
    }

    onPhase?.("downloading")
    await addContentToBuild(activeBuild.id, type, mod)
    onPhase?.(null)
  }, [activeBuild, addContentToBuild, askAboutDeps, buildIrisDep, doDownloadDep, filterDepsForBuild, isInstalledBuildMod, planDeps, shaderNeedsIris])

  const installModToBuild = useCallback(async (
    mod: ModSearchResult,
    onPhase?: (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => void,
  ) => {
    const source = mod.source as "modrinth" | "curseforge"

    // Уведомление показываем сразу по клику и ведём его до конца установки: иначе
    // первые секунды (поиск версии, окно зависимостей) в панели была тишина, а
    // запись появлялась только на скачивании.
    beginContentInstall({
      title: t("builds.mod.installing"),
      message: t("mods.install.phaseResolving"),
      itemName: mod.name,
    })

    // Сначала сетевые запросы: версии, потом зависимости. Это несколько секунд,
    // поэтому этап подписан — иначе прогресс «висит» без объяснений.
    onPhase?.("resolving")

    let selectedVersion: ModVersion | undefined
    if (source === "modrinth") {
      const versions = await window.electronAPI?.modsModrinthVersions(mod.projectId ?? mod.slug)
      selectedVersion = pickCompatibleVersion(versions, activeBuild)
    } else if (source === "curseforge" && mod.modId) {
      const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
      selectedVersion = pickCompatibleVersion(details?.versions ?? [], activeBuild)
    }

    if (!selectedVersion) {
      endContentInstall()
      return
    }

    const overrideMeta = { name: mod.name, description: mod.summary, iconUrl: mod.iconUrl, projectId: mod.projectId, modId: mod.modId }

    const resolvedDeps = await resolveRequiredDeps(selectedVersion, source, mod.modId)
    const missingRequiredDeps = await filterDepsForBuild(resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(installedMod =>
        isInstalledBuildMod(installedMod, source, dep.projectId, source === "curseforge" ? Number(dep.projectId) : undefined, dep.slug || dep.projectId),
      )
    }), source)

    // Зависимости обязательные, выбирать нечего — спрашиваем согласие одним окном.
    // Версии подбираем заранее, чтобы в окне было видно, что именно поставим.
    let depsToInstall = missingRequiredDeps
    let depVersions: Map<string, ModVersion> | undefined
    if (missingRequiredDeps.length > 0) {
      onPhase?.("confirm")
      updateContentInstall({ message: t("mods.install.phaseConfirm") })
      const plan = await planDeps(missingRequiredDeps, source)
      const approved = await askAboutDeps(mod.name, mod.iconUrl, source, plan)
      if (!approved) {
        // Отказ: окно закрылось, установка не началась.
        endContentInstall()
        onPhase?.(null)
        return
      }
      depsToInstall = approved.map(item => item.dep)
      depVersions = new Map(approved.filter(item => item.version).map(item => [item.dep.projectId, item.version!]))
    }

    // Текст уведомления ведём по тем же этапам, что подпись на карточке:
    // до этого «зависимости» сразу перекрывались «скачиванием».
    const reportPhase = (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => {
      onPhase?.(phase)
      if (phase === "downloading") {
        updateContentInstall({ message: t("builds.mod.downloading", { name: mod.name }) })
      } else if (phase === "deps") {
        updateContentInstall({ message: t("mods.install.phaseDeps") })
      }
    }

    try {
      await installVersionWithDeps(selectedVersion, source, depsToInstall, overrideMeta, reportPhase, depVersions)
    } finally {
      endContentInstall()
    }
  }, [activeBuild, activeBuild.id, activeBuild.mods, askAboutDeps, beginContentInstall, endContentInstall, filterDepsForBuild, installVersionWithDeps, isInstalledBuildMod, planDeps, resolveRequiredDeps, t, updateContentInstall])

  const handleInstallVersion = useCallback(async (version: ModVersion): Promise<boolean> => {
    if (!selectedDetails) return false

    if (selectedDetails.source === "ftb") {
      return false
    }

    const source = selectedDetails.source
    beginContentInstall({
      title: t("builds.mod.installing"),
      message: t("mods.install.phaseResolving"),
      itemName: selectedDetails.name,
    })
    const resolvedDeps = await resolveRequiredDeps(version, source, selectedDetails.modId)
    const missingRequiredDeps = await filterDepsForBuild(resolvedDeps.filter(dep => {
      if (dep.dependencyType !== "required") return false
      return !activeBuild.mods.some(mod => isInstalledBuildMod(
        mod,
        source,
        dep.projectId,
        source === "curseforge" ? Number(dep.projectId) : undefined,
        dep.slug || dep.projectId,
      ))
    }), source)

    // Зависимости обязательные — одно окно подтверждения, затем установка в списке модов.
    let depsToInstall = missingRequiredDeps
    let depVersions: Map<string, ModVersion> | undefined
    if (missingRequiredDeps.length > 0) {
      updateContentInstall({ message: t("mods.install.phaseConfirm") })
      const plan = await planDeps(missingRequiredDeps, source)
      const approved = await askAboutDeps(selectedDetails.name, selectedDetails.iconUrl, source, plan)
      if (!approved) {
        endContentInstall()
        return false
      }
      depsToInstall = approved.map(item => item.dep)
      depVersions = new Map(approved.filter(item => item.version).map(item => [item.dep.projectId, item.version!]))
    }

    // Текст уведомления ведём по тем же этапам, что подпись на карточке.
    const reportPhase = (phase: "resolving" | "confirm" | "downloading" | "deps" | null) => {
      if (phase === "downloading") {
        updateContentInstall({ message: t("builds.mod.downloading", { name: selectedDetails.name }) })
      } else if (phase === "deps") {
        updateContentInstall({ message: t("mods.install.phaseDeps") })
      }
    }

    try {
      await installVersionWithDeps(version, source, depsToInstall, undefined, reportPhase, depVersions)
    } finally {
      endContentInstall()
    }
    return true
  }, [activeBuild.mods, askAboutDeps, beginContentInstall, endContentInstall, filterDepsForBuild, installVersionWithDeps, isInstalledBuildMod, planDeps, resolveRequiredDeps, selectedDetails, t, updateContentInstall])

  /**
   * Версия открытого в окне мода, если он уже стоит в сборке. Нужна, чтобы
   * в списке версий отметить текущую и не предлагать её «Скачать» повторно.
   */
  const installedModalVersion = useMemo(() => {
    if (!selectedDetails) return undefined
    const source = selectedDetails.source
    if (source !== "modrinth" && source !== "curseforge") return undefined
    const match = activeBuild.mods.find(installedMod => isInstalledBuildMod(
      installedMod,
      source,
      selectedDetails.projectId ?? selectedDetails.id,
      source === "curseforge" ? selectedDetails.modId : undefined,
      selectedDetails.slug || selectedDetails.projectId,
    ))
    return match?.version
  }, [selectedDetails, activeBuild.mods, isInstalledBuildMod])

  const handleUpdateModpack = useCallback(async (version: ModVersion): Promise<boolean> => {
    if (!selectedDetails || selectedDetails.source === "ftb") return false
    await installVersionWithDeps(version, selectedDetails.source, [])
    return true
  }, [selectedDetails, installVersionWithDeps])

  return (
    <div className="h-full flex flex-col animate-in fade-in-0 duration-300">
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={goToMyBuilds}
            className="p-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
          >
            <IconArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 rounded-2xl bg-muted/50 px-4 py-2.5">
            {buildHasImage && (
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                <EntityIcon src={activeBuild.icon} className="w-full h-full p-1 text-primary" imgClassName="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-foreground">{activeBuild.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderIcon loaderId={activeBuild.modLoader} className="w-4 h-4 text-muted-foreground inline-block flex-shrink-0" />
                <span>{loaderLabel(activeBuild.modLoader)} · {activeBuild.version}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-0.5 p-1 rounded-xl bg-muted/30 border border-border/50">
            {([
              { tab: "general" as const, icon: IconInfoCircle, label: t("builds.tab.general"), locked: false },
              { tab: "settings" as const, icon: IconSettings, label: t("builds.tab.settings"), locked: false },
              ...(!isVanilla ? [
                { tab: "mods" as const, icon: IconPuzzle, label: t("builds.tab.mods"), locked: isLocked },
                { tab: "resourcepacks" as const, icon: IconPhoto, label: t("builds.tab.resourcepacks"), locked: isLocked },
                { tab: "shaders" as const, icon: IconSparkles, label: t("builds.tab.shaders"), locked: isLocked },
              ] : []),
            ]).map(({ tab, icon: Icon, label, locked }) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabClick(tab)}
                title={locked ? t("buildDetail.tab.locked") : undefined}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
                  detailTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : locked
                      ? "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 cursor-pointer"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                <span>{label}</span>
                {locked && <IconLock className="w-3 h-3 text-amber-500/80 shrink-0 ml-0.5" />}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 p-1 rounded-xl bg-muted/30 border border-border/50">
            {([
              { tab: "servers" as const, icon: IconServer, label: t("builds.tab.servers") },
              { tab: "worlds" as const, icon: IconMap, label: t("builds.tab.worlds") },
              { tab: "screenshots" as const, icon: IconCamera, label: t("builds.tab.screenshots") },
            ]).map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailTab(tab)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
                  detailTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {detailTab === "settings" && (
        <InstanceBuildSettings build={activeBuild} updateBuild={updateBuild} />
      )}

      {detailTab === "general" && (
        <InstanceDetailGeneral
          activeBuild={activeBuild}
          updateBuild={updateBuild}
          renameBuild={renameBuild}
          onTrash={onTrash}
        />
      )}

      {detailTab === "mods" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title={t("buildDetail.search.title")}
          placeholder={t("buildDetail.search.modsPlaceholder")}
          uploadLabel={t("buildDetail.search.modsUpload")}
          type="mods"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadModFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          installContentToBuild={installContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "resourcepacks" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title={t("buildDetail.search.title")}
          placeholder={t("buildDetail.search.resourcepacksPlaceholder")}
          uploadLabel={t("buildDetail.search.resourcepacksUpload")}
          type="resourcepacks"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadResourcepackFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          installContentToBuild={installContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "shaders" && (
        <InstanceContentTab
          activeBuild={activeBuild}
          title={t("buildDetail.search.title")}
          placeholder={t("buildDetail.search.shadersPlaceholder")}
          uploadLabel={t("buildDetail.search.shadersUpload")}
          type="shaders"
          modSearch={modSearch}
          setModSearch={setModSearch}
          modSource={modSource}
          setModSource={setModSource}
          modSortBy={modSortBy}
          setModSortBy={setModSortBy}
          modCategories={modCategories}
          setModCategories={setModCategories}
          categories={categories}
          modFileInputRef={modFileInputRef}
          onUploadFile={handleUploadShaderFile}
          modLoading={modLoading}
          modTotalHits={modTotalHits}
          modTotalPages={modTotalPages}
          modPage={modPage}
          setModPage={setModPage}
          displayResults={displayResults}
          isInstalledFn={isInstalledFn}
          openProjectModal={openProjectModal}
          installingModSlug={installingModSlug}
          setInstallingModSlug={setInstallingModSlug}
          addModToBuild={addModToBuild}
          addContentToBuild={addContentToBuild}
          installContentToBuild={installContentToBuild}
          removeContentFromBuild={removeContentFromBuild}
          installModToBuild={installModToBuild}
          setBuilds={setBuilds}
          toggleItemEnabled={toggleItemEnabled}
          updateItemVersion={updateItemVersion}
        />
      )}

      {detailTab === "worlds" && (
        <InstanceWorldsTab build={activeBuild} />
      )}

      {detailTab === "servers" && (
        <InstanceServersTab build={activeBuild} updateBuild={updateBuild} />
      )}

      {detailTab === "screenshots" && (
        <InstanceScreenshotsTab build={activeBuild} />
      )}

      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        versionsFallback={versionsFallback}
        versionsLoaderFiltered={versionsLoaderFiltered}
        onShowAllVersions={onShowAllVersions}
        allVersionsCount={allVersionsCount}
        onInstallVersion={handleInstallVersion}
        onClose={closeModal}
        activeBuild={activeBuild}
        installedVersion={installedModalVersion}
        onUpdateModpack={handleUpdateModpack}
      />

      {/* Нужны зависимости: одно окно, согласие — и установка продолжается в списке */}
      <DepConfirmDialog
        open={depConfirm !== null}
        modName={depConfirm?.modName ?? ""}
        modIcon={depConfirm?.modIcon}
        source={depConfirm?.source ?? "modrinth"}
        items={depConfirm?.items ?? []}
        onConfirm={() => answerDeps(depConfirm?.items ?? [])}
        onCancel={() => answerDeps(null)}
      />

      <ActionConfirmDialog
        open={lockedTargetTab !== null}
        onClose={() => setLockedTargetTab(null)}
        onConfirm={() => {
          updateBuild(activeBuild.id, { locked: false })
          if (lockedTargetTab) {
            setDetailTab(lockedTargetTab)
            setLockedTargetTab(null)
          }
        }}
        title={t("buildDetail.locked.title")}
        description={t("buildDetail.locked.description", { name: activeBuild.name })}
        confirmText={t("buildDetail.locked.confirm")}
        cancelText={t("buildDetail.locked.cancel")}
        variant="warning"
        icon="lock"
      />
    </div>
  )
})
