import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useAccounts } from "@/src/AccountsContext"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { EditSkinModal } from "./edit-skin-modal"
import { localFileToBlobUrl } from "@/lib/local-file-url"
import { EmptySkinsState, SkinPreviewPanel, SkinGrid } from "./skins"
import type { SkinCardData } from "./skins"
import type { McProfile, LibrarySkin } from "@xnlc/types"
import { IconShirt, IconLoader2 } from "@tabler/icons-react"

export function SkinsPage() {
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
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initializedRef = useRef(false)
  // Аккаунт, для которого сейчас идёт/выполнилась загрузка — защита от гонки при смене аккаунта
  const activeAccountIdRef = useRef<string | null>(null)
  const loadedForAccountIdRef = useRef<string | null>(null)

  // Load blob URLs for library skins
  useEffect(() => {
    let cancelled = false
    const loadBlobUrls = async () => {
      const newUrls = new Map<string, string>()
      for (const skin of librarySkins) {
        const existing = skinBlobUrls.get(skin.id)
        if (existing) {
          newUrls.set(skin.id, existing)
        } else {
          const url = await localFileToBlobUrl(skin.filePath)
          if (!cancelled && url) newUrls.set(skin.id, url)
        }
      }
      if (!cancelled) setSkinBlobUrls(newUrls)
    }
    loadBlobUrls()
    return () => { cancelled = true }
  }, [librarySkins])

  const fetchProfile = useCallback(async () => {
    const accountId = account?.id
    if (!accountId || !window.electronAPI) return
    try {
      const result = await window.electronAPI.skinsGetProfile(accountId)
      // Ответ мог прийти уже после смены аккаунта — отбрасываем
      if (activeAccountIdRef.current !== accountId) return
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
    } catch {
      if (activeAccountIdRef.current !== accountId) return
      setActiveSkinUrl("")
    }
  }, [account?.id])

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
      pushNotification({ kind: "error", source: "import", title: "Ошибка", message: String(err) })
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
      const lastAppliedId = localStorage.getItem(`skin-equipped-${account?.id}`)
      const match = lastAppliedId && librarySkins.some(s => s.id === lastAppliedId)
        ? lastAppliedId
        : librarySkins[0].id
      setSelectedId(match)
      setEquippedId(match)
    } else if (activeSkinUrl) {
      setSelectedId("__api__")
      setEquippedId("__api__")
    }
    initializedRef.current = true
  }, [loading, activeSkinUrl, librarySkins, account?.id])

  const activeCape = profile?.capes?.find((c) => c.state === "ACTIVE")

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
    if (selectedSkin.capeId) {
      const cape = profile?.capes?.find(c => c.id === selectedSkin.capeId)
      if (cape?.url) return cape.url
    }
    return activeCape?.url
  }, [selectedSkin, profile, activeCape])

  const handleUploadFile = useCallback(async (file: File) => {
    if (!window.electronAPI || !account?.id) return
    try {
      const filePath = window.electronAPI.getFilePath(file)
      const name = file.name.replace(/\.png$/i, "")
      const variant = selectedSkin?.variant ?? "classic"
      const saved = await window.electronAPI.skinsSaveToLibrary(filePath, name, variant, account.id)
      if (saved) {
        await fetchLibrary()
        setSelectedId(saved.id)
        pushNotification({ kind: "success", source: "import", title: "Скин добавлен", message: name })
      }
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: "Ошибка загрузки", message: String(err) })
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
        await fetchProfile()
        setEquippedId(selectedSkin.id)
        setSelectedId(selectedSkin.id)
        pushNotification({ kind: "success", source: "launch", title: "Скин применён", message: "" })
      }
    } catch (err) {
      pushNotification({ kind: "error", source: "launch", title: "Ошибка", message: String(err) })
    } finally {
      setIsApplying(false)
    }
  }, [account?.id, selectedSkin, isApplying, fetchProfile, pushNotification])

  const handleReset = useCallback(async () => {
    if (!window.electronAPI || !account?.id) return
    try {
      await window.electronAPI.skinsDeleteSkin(account.id)
      localStorage.removeItem(`skin-equipped-${account.id}`)
      await fetchProfile()
      const apiSkinId = activeSkinUrl ? "__api__" : null
      setEquippedId(apiSkinId)
      setSelectedId(apiSkinId)
      pushNotification({ kind: "success", source: "launch", title: "Скин сброшен", message: "Возвращён стандартный скин" })
    } catch (err) {
      pushNotification({ kind: "error", source: "launch", title: "Ошибка", message: String(err) })
    }
  }, [account?.id, activeSkinUrl, fetchProfile, pushNotification])

  const handleDeleteSkin = useCallback(async (skinId: string) => {
    if (!window.electronAPI || !account?.id) return
    if (skinId === "__api__") {
      await handleReset()
      return
    }
    try {
      await window.electronAPI.skinsDeleteFromLibrary(skinId)
      if (selectedId === skinId) {
        setSelectedId(equippedId)
      }
      if (equippedId === skinId) {
        localStorage.removeItem(`skin-equipped-${account.id}`)
        setEquippedId(null)
      }
      await fetchLibrary()
      pushNotification({ kind: "success", source: "import", title: "Скин удалён", message: "" })
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: "Ошибка", message: String(err) })
    }
  }, [selectedId, equippedId, account?.id, fetchLibrary, handleReset, pushNotification])

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
      if (!editModalSkin) {
        await window.electronAPI.skinsSetCape(params.capeId, account.id)
      }
      await fetchLibrary()
      await fetchProfile()
      pushNotification({ kind: "success", source: "import", title: "Скин сохранён", message: "" })
    } catch (err) {
      pushNotification({ kind: "error", source: "import", title: "Ошибка", message: String(err) })
    }
  }, [account?.id, editModalSkin, fetchLibrary, fetchProfile, pushNotification])

  const handleEditClick = useCallback((skin?: SkinCardData) => {
    setEditModalSkin(skin?.librarySkin ?? null)
    setEditModalOpen(true)
  }, [])

  // Handle file selection from SkinGrid's hidden input
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent).detail as File
      if (file) handleUploadFile(file)
    }
    window.addEventListener("skin-file-selected", handler)
    return () => window.removeEventListener("skin-file-selected", handler)
  }, [handleUploadFile])

  // Пока поддерживаются только аккаунты Microsoft
  if (account?.type !== "microsoft") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Page Header */}
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center">
            <IconShirt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              {t("skins.title", "Скины")}
            </h1>
            <p className="text-xs text-muted-foreground/60">
              {t("skins.subtitle", "Управляйте внешним видом персонажа")}
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,2.5fr)] gap-6">
          <SkinPreviewPanel
            selectedSkin={undefined}
            selectedCapeUrl={undefined}
            hasPendingChange={false}
            isApplying={false}
            loading={false}
            profile={null}
            onApply={() => {}}
            onReset={() => {}}
            onEdit={() => {}}
            onCancelSelection={() => {}}
          />
          <EmptySkinsState />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <input ref={fileInputRef} type="file" accept=".png" className="hidden" onChange={handleFileInput} />

      <EditSkinModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        skin={editModalSkin}
        capes={profile?.capes ?? []}
        activeCapeId={editModalSkin?.capeId ?? activeCape?.id ?? null}
        onSave={handleEditSave}
      />

      {/* Page Header */}
      <div className="flex items-center gap-3 mb-5 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center">
          <IconShirt className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">
            {t("skins.title", "Скины")}
          </h1>
          <p className="text-xs text-muted-foreground/60">
            {t("skins.subtitle", "Управляйте внешним видом персонажа")}
          </p>
        </div>
        {loading && (
          <IconLoader2 className="w-4 h-4 text-muted-foreground/40 animate-spin ml-2" />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,2.5fr)] gap-6">
        <SkinPreviewPanel
          selectedSkin={selectedSkin}
          selectedCapeUrl={selectedCapeUrl}
          hasPendingChange={hasPendingSkinChange}
          isApplying={isApplying}
          loading={loading}
          profile={profile}
          onApply={handleApply}
          onReset={handleReset}
          onEdit={() => handleEditClick(selectedSkin)}
          onCancelSelection={() => setSelectedId(equippedId)}
        />

        <SkinGrid
          skins={allSkins}
          selectedId={selectedId}
          equippedId={equippedId}
          loading={loading}
          dragOver={dragOver}
          capes={profile?.capes ?? []}
          onSelect={setSelectedId}
          onEdit={(skin) => handleEditClick(skin)}
          onDelete={handleDeleteSkin}
          onAddNew={() => { setEditModalSkin(null); setEditModalOpen(true) }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        />
      </div>
    </div>
  )
}
