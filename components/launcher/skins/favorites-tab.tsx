import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useAccounts } from "@/src/AccountsContext"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { EditSkinModal } from "../edit-skin-modal"
import { localFileToBlobUrl } from "@/lib/local-file-url"
import { EmptySkinsState, SkinPreviewPanel, SkinGrid, type SkinCardData } from "./index"
import { resolveSkinCapeUrl, findActiveCape } from "./cape-url"
import type { McProfile, LibrarySkin } from "@xnlc/types"
import { IconLoader2 } from "@tabler/icons-react"

/**
 * Кэш профиля скинов на уровне модуля.
 *
 * `skins:get-profile` в main ходит в сеть (Mojang/xnskins/elyby) — это 0.2–0.6 с,
 * и раньше вкладка ждала этот ответ, прежде чем показать активный скин и плащи.
 * Теперь при повторном входе профиль берётся из кэша сразу (мгновенная отрисовка),
 * а обновление идёт в фоне.
 */
const profileCache = new Map<string, { profile: McProfile | null; at: number }>()

/** TTL, после которого профиль обновляем в фоне (показанные данные не блокируют). */
const PROFILE_CACHE_TTL_MS = 60_000

/**
 * Вкладка «Избранное»: сохранённые скины аккаунта.
 *
 * Раскладка — как у «Библиотеки»: слева компактная панель с аккаунтом, превью
 * и действиями, справа тулбар и сетка, которая скроллится сама. Функции
 * прежние: активный скин, применение, редактирование и сброс.
 */
export function FavoritesTab() {
  const { t } = useTranslation()
  const { accounts, activeAccount } = useAccounts()
  const { pushNotification } = useActivityCenter()

  const account = activeAccount ?? accounts[0]

  const [librarySkins, setLibrarySkins] = useState<LibrarySkin[]>([])
  const [skinBlobUrls, setSkinBlobUrls] = useState<Map<string, string>>(new Map())
  const [profile, setProfile] = useState<McProfile | null>(null)
  const [activeSkinUrl, setActiveSkinUrl] = useState<string>("")
  const [activeSkinVariant, setActiveSkinVariant] = useState<"classic" | "slim">("classic")
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [equippedId, setEquippedId] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editModalSkin, setEditModalSkin] = useState<LibrarySkin | null>(null)
  /**
   * Правим текущий скин аккаунта (карточка из профиля), а не запись в
   * «Избранном». Только в этом случае смена плаща в модалке уходит на аккаунт:
   * при добавлении нового скина плащ аккаунта трогать нельзя.
   */
  const [editingCurrentSkin, setEditingCurrentSkin] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [skinVersion, setSkinVersion] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initializedRef = useRef(false)
  // Аккаунт, для которого сейчас идёт/выполнилась загрузка — защита от гонки при смене аккаунта
  const activeAccountIdRef = useRef<string | null>(null)
  const loadedForAccountIdRef = useRef<string | null>(null)

  // Blob-URL для превью сохранённых скинов. Чтение каждого PNG идёт через IPC
  // (`skins:read-local-file`), поэтому кэш по пути файла ведёт сам
  // `localFileToBlobUrl` — здесь второй такой же кэш не нужен.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      librarySkins.map(async (skin) => [skin.id, await localFileToBlobUrl(skin.filePath)] as const),
    ).then((entries) => {
      if (cancelled) return
      setSkinBlobUrls(new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    })
    return () => { cancelled = true }
  }, [librarySkins])

  /** Применяет профиль к состоянию: активный скин, его вариант, плащи. */
  const applyProfile = useCallback((result: McProfile | null) => {
    setProfile(result ?? null)
    if (result?.skins) {
      const active = result.skins.find((s) => s.state === "ACTIVE")
      if (active?.url) {
        setActiveSkinUrl(active.url)
        setActiveSkinVariant(active.variant === "SLIM" ? "slim" : "classic")
      } else {
        setActiveSkinUrl("")
      }
    }
  }, [])

  const fetchProfile = useCallback(async (force = false) => {
    const accountId = account?.id
    if (!accountId || !window.electronAPI) return

    // Мгновенная отрисовка из кэша: сетевой запрос уходит в фон.
    // `force` — после смены/сброса скина: там нужен свежий ответ, а не кэш.
    const cached = force ? undefined : profileCache.get(accountId)
    if (cached) {
      applyProfile(cached.profile)
      if (Date.now() - cached.at < PROFILE_CACHE_TTL_MS) return
    }

    try {
      const result = await window.electronAPI.skinsGetProfile(accountId)
      // Ответ мог прийти уже после смены аккаунта — отбрасываем
      if (activeAccountIdRef.current !== accountId) return
      profileCache.set(accountId, { profile: result ?? null, at: Date.now() })
      applyProfile(result ?? null)
    } catch {
      if (activeAccountIdRef.current !== accountId) return
      if (!cached) setActiveSkinUrl("")
    }
  }, [account?.id, applyProfile])

  const fetchLibrary = useCallback(async () => {
    const accountId = account?.id
    if (!accountId || !window.electronAPI) return
    setLoading(true)
    try {
      const skins = await window.electronAPI.skinsListLibrary(accountId)
      // Ответ мог прийти уже после смены аккаунта — отбрасываем
      if (activeAccountIdRef.current !== accountId) return
      setLibrarySkins(skins)
      loadedForAccountIdRef.current = accountId
    } catch (err) {
      if (activeAccountIdRef.current !== accountId) return
      pushNotification({ kind: "error", source: "import", title: t("skins.error"), message: String(err) })
    } finally {
      if (activeAccountIdRef.current === accountId) setLoading(false)
    }
  }, [account?.id, pushNotification])

  const reloadAll = useCallback(async () => {
    await Promise.all([fetchLibrary(), fetchProfile()])
  }, [fetchLibrary, fetchProfile])

  useEffect(() => {
    activeAccountIdRef.current = account?.id ?? null
    initializedRef.current = false
    setSelectedId(null)
    setEquippedId(null)
    setLoading(true)
    reloadAll()
  }, [account?.id])

  useEffect(() => {
    if (loading || initializedRef.current) return
    // Автовыбор только по данным, загруженным именно для текущего аккаунта
    if (loadedForAccountIdRef.current !== account?.id) return
    if (librarySkins.length > 0) {
      /**
       * Что надето, знает только отметка о применении: сопоставить запись
       * библиотеки с активной текстурой аккаунта нечем — Mojang отдаёт свой
       * хэш, а у записи хранится файл либо хэш Laby.
       *
       * Раньше при отсутствии отметки «надетым» объявлялся `librarySkins[0]`
       * (список идёт по `createdAt DESC`, то есть самый свежий). Из-за этого
       * скин, только что добавленный из каталога в избранное, показывался как
       * надетый, хотя его не надевали. Хуже того, у «надетого» скина скрыта
       * кнопка удаления — убрать такую запись из сетки было нельзя.
       */
      const appliedId = localStorage.getItem(`skin-equipped-${account?.id}`)
      const equipped = appliedId && librarySkins.some((s) => s.id === appliedId) ? appliedId : null
      setEquippedId(equipped)
      // Выбор — отдельное от «надет» понятие: показываем надетый скин, а если
      // ничего не надето, то самый свежий, чтобы превью не пустовало.
      setSelectedId(equipped ?? librarySkins[0].id)
    } else if (activeSkinUrl) {
      setSelectedId("__api__")
      setEquippedId("__api__")
    }
    initializedRef.current = true
  }, [loading, activeSkinUrl, librarySkins, account?.id])

  const activeCape = findActiveCape(profile?.capes)

  /**
   * Полный список скинов аккаунта — без учёта поиска.
   *
   * Панель слева выбирает скин именно отсюда: иначе поиск, не совпавший с
   * выбранным скином, обнулял бы превью и блокировал кнопки «Изменить» и
   * «Применить», хотя скин никуда не делся.
   */
  const allSkins = useMemo(() => {
    const skins: SkinCardData[] = []

    for (const s of librarySkins) {
      skins.push({
        id: s.id,
        name: s.name,
        blobUrl: skinBlobUrls.get(s.id) ?? "",
        variant: s.variant,
        isEquipped: false,
        capeId: s.capeId ?? null,
        librarySkin: s,
      })
    }

    // Скин с сервера показываем, когда в библиотеке пусто.
    if (activeSkinUrl && librarySkins.length === 0) {
      skins.push({
        id: "__api__",
        name: t("skins.currentSkin", "Текущий скин"),
        blobUrl: activeSkinUrl,
        variant: activeSkinVariant,
        isEquipped: true,
        capeId: activeCape?.id ?? null,
      })
    }

    return skins
  }, [librarySkins, skinBlobUrls, activeSkinUrl, activeSkinVariant, activeCape, t])

  const selectedSkin = allSkins.find(s => s.id === selectedId)
  const hasPendingSkinChange = selectedId !== null && selectedId !== equippedId

  const selectedCapeUrl = useMemo(() => {
    if (!selectedSkin) return undefined
    return resolveSkinCapeUrl(selectedSkin.capeId, profile?.capes)
  }, [selectedSkin, profile])

  const handleUploadFile = useCallback(async (file: File) => {
    if (!window.electronAPI || !account?.id) return
    try {
      const filePath = window.electronAPI.getFilePath(file)
      const name = file.name.replace(/\.png$/i, "")
      const variant = selectedSkin?.variant ?? "classic"
      // Плащ к новому скину не привязываем: раньше сюда уходил активный плащ
      // аккаунта, и добавленный скин выглядел так, будто ему сразу надели плащ.
      // Плащ выбирается явно в модалке редактирования.
      const saved = await window.electronAPI.skinsSaveToLibrary(filePath, name, variant, account.id, null)
      if (saved) {
        await fetchLibrary()
        setSelectedId(saved.id)
        pushNotification({ kind: "success", source: "import", title: t("skins.added"), message: name })
      }
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: t("skins.uploadError"), message: String(err) })
    }
  }, [account?.id, selectedSkin, fetchLibrary, pushNotification])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await handleUploadFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [handleUploadFile])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith(".png")) await handleUploadFile(file)
  }, [handleUploadFile])

  const handleApply = useCallback(async () => {
    if (!window.electronAPI || !account?.id || !selectedSkin || isApplying) return
    if (selectedSkin.id === "__api__") return

    setIsApplying(true)
    try {
      const ok = await window.electronAPI.skinsApplyLibrarySkin(selectedSkin.id, account.id)
      if (ok) {
        localStorage.setItem(`skin-equipped-${account.id}`, selectedSkin.id)
        await fetchProfile(true)
        setEquippedId(selectedSkin.id)
        setSelectedId(selectedSkin.id)
        setSkinVersion(v => v + 1)
        pushNotification({ kind: "success", source: "launch", title: t("skins.applied"), message: "" })
      } else {
        // Раньше неудача молчала: кнопка нажималась, и ничего не происходило.
        pushNotification({ kind: "error", source: "launch", title: t("skins.error"), message: selectedSkin.name })
      }
    } catch (err) {
      pushNotification({ kind: "error", source: "launch", title: t("skins.error"), message: String(err) })
    } finally {
      setIsApplying(false)
    }
  }, [account?.id, selectedSkin, isApplying, fetchProfile, pushNotification])

  const handleReset = useCallback(async () => {
    if (!window.electronAPI || !account?.id) return
    try {
      // Раньше результат не проверялся, и «Сбросить» показывало успех даже
      // когда запрос к Minecraft Services не прошёл.
      const ok = await window.electronAPI.skinsDeleteSkin(account.id)
      if (!ok) {
        pushNotification({ kind: "error", source: "launch", title: t("skins.error"), message: "" })
        return
      }
      localStorage.removeItem(`skin-equipped-${account.id}`)
      await fetchProfile(true)
      // Скин с аккаунта снят — надетого больше нет. Раньше сюда подставлялся
      // `"__api__"` по устаревшему (до сброса) `activeSkinUrl`, и панель
      // показывала «Надет», хотя скина на аккаунте уже не было; карточки с
      // таким id в сетке тоже нет, поэтому выбор становился фантомным.
      setEquippedId(null)
      setSelectedId((prev) => (prev === "__api__" ? null : prev))
      setSkinVersion(v => v + 1)
      pushNotification({ kind: "success", source: "launch", title: t("skins.reset"), message: t("skins.resetMessage") })
    } catch (err) {
      pushNotification({ kind: "error", source: "launch", title: t("skins.error"), message: String(err) })
    }
  }, [account?.id, fetchProfile, pushNotification, t])

  const handleDeleteSkin = useCallback(async (skinId: string) => {
    if (!window.electronAPI || !account?.id) return
    if (skinId === "__api__") {
      await handleReset()
      return
    }
    try {
      await window.electronAPI.skinsDeleteFromLibrary(skinId)
      if (selectedId === skinId) {
        // Надетого может не быть вовсе (скин добавлен, но не надет) — тогда берём
        // любую оставшуюся запись, чтобы превью не осталось без скина и без
        // выделенной карточки.
        const fallback = equippedId ?? librarySkins.find((s) => s.id !== skinId)?.id ?? null
        setSelectedId(fallback)
      }
      if (equippedId === skinId) {
        localStorage.removeItem(`skin-equipped-${account.id}`)
        setEquippedId(null)
      }
      await fetchLibrary()
      pushNotification({ kind: "success", source: "import", title: t("skins.deleted"), message: "" })
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: t("skins.error"), message: String(err) })
    }
  }, [selectedId, equippedId, librarySkins, account?.id, fetchLibrary, handleReset, pushNotification])

  const handleEditSave = useCallback(async (params: { filePath?: string; variant: "classic" | "slim"; capeId: string | null }) => {
    if (!window.electronAPI || !account?.id) return
    try {
      if (params.filePath && editModalSkin) {
        const name = editModalSkin.name
        const saved = await window.electronAPI.skinsSaveToLibrary(params.filePath, name, params.variant, account.id, params.capeId)
        if (saved) setSelectedId(saved.id)
      } else if (params.filePath) {
        const name = "skin"
        const saved = await window.electronAPI.skinsSaveToLibrary(params.filePath, name, params.variant, account.id, params.capeId)
        if (saved) setSelectedId(saved.id)
      } else if (editModalSkin) {
        await window.electronAPI.skinsUpdateVariant(editModalSkin.id, params.variant, params.capeId)
      }
      if (editingCurrentSkin) {
        // Меняем плащ у скина, который сейчас надет, — только это действие
        // должно доходить до аккаунта.
        await window.electronAPI.skinsSetCape(params.capeId, account.id)
      }
      await fetchLibrary()
      await fetchProfile(true)
      pushNotification({ kind: "success", source: "import", title: t("skins.saved"), message: "" })
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: t("skins.error"), message: String(err) })
    }
  }, [account?.id, editModalSkin, editingCurrentSkin, fetchLibrary, fetchProfile, pushNotification])

  const handleEditClick = useCallback((skin?: SkinCardData) => {
    // Карточка без `librarySkin` — это скин из профиля аккаунта, у него правка
    // идёт на аккаунт, а не в запись «Избранного».
    setEditingCurrentSkin(Boolean(skin) && !skin?.librarySkin)
    setEditModalSkin(skin?.librarySkin ?? null)
    setEditModalOpen(true)
  }, [])

  const handleAddNew = useCallback(() => {
    setEditingCurrentSkin(false)
    setEditModalSkin(null)
    setEditModalOpen(true)
  }, [])

  // Пока поддерживаются только аккаунты Microsoft
  if (account?.type !== "microsoft") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptySkinsState />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input ref={fileInputRef} type="file" accept=".png" className="hidden" onChange={handleFileInput} />

      <EditSkinModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        skin={editModalSkin}
        capes={profile?.capes ?? []}
        // Новый скин открывается без плаща, у записи «Избранного» — её плащ,
        // у скина из профиля — текущий плащ аккаунта.
        activeCapeId={editModalSkin?.capeId ?? (editingCurrentSkin ? activeCape?.id ?? null : null)}
        onSave={handleEditSave}
      />

      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 @[820px]:grid-cols-[280px_minmax(0,1fr)] @[820px]:overflow-hidden">
          <SkinPreviewPanel
            selectedSkin={selectedSkin}
            selectedCapeUrl={selectedCapeUrl}
            hasPendingChange={hasPendingSkinChange}
            canCancelSelection={equippedId !== null}
            isApplying={isApplying}
            loading={loading}
            profile={profile}
            skinVersion={skinVersion}
            onApply={handleApply}
            onReset={handleReset}
            onEdit={() => handleEditClick(selectedSkin)}
            onCancelSelection={() => setSelectedId(equippedId)}
          />

          <div className="flex min-h-0 flex-col gap-3 @[820px]:overflow-hidden">
            {/* Счётчик без спиннера: загрузка показывается по центру сетки. */}
            {!loading && (
              <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                {allSkins.length} {t("skins.skinsCount", "скинов")}
              </span>
            )}

            <div className="@container min-h-0 @[820px]:flex-1 @[820px]:overflow-y-auto @[820px]:pr-1">
              <SkinGrid
                skins={allSkins}
                selectedId={selectedId}
                equippedId={equippedId}
                loading={loading}
                dragOver={dragOver}
                capes={profile?.capes ?? []}
                previewVersion={skinVersion}
                onSelect={setSelectedId}
                onEdit={(skin) => handleEditClick(skin)}
                onDelete={handleDeleteSkin}
                onAddNew={handleAddNew}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}