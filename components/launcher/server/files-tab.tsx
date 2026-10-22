import { useContentEnter } from "../content-motion"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  IconFolder, IconFile, IconFileCode, IconFileText,
  IconArrowLeft, IconHome, IconRefresh, IconPlus,
  IconPencil, IconTrash, IconCheck, IconX, IconSearch,
  IconLoader2, IconChevronRight,
} from "@tabler/icons-react"
import type { McFsEntry } from "@xnlc/types"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import Editor from "react-simple-code-editor"
import Prism from "prismjs"

// prismjs-компоненты (prism-json, prism-java и т.д.) — это side-effect скрипты,
// которые обращаются к ГЛОБАЛЬНОМУ `Prism`. В dev-режиме глобал успевает
// выставиться сам, но в собранном бандле порядок чанков другой, и они падают с
// "Prism is not defined" (ESM-hoisting выносит их раньше `prismjs`).
// Поэтому берём их исходники как строки и выполняем вручную, передавая Prism
// напрямую — без зависимости от глобальной области.
import prismJsonSrc from "prismjs/components/prism-json.js?raw"
import prismYamlSrc from "prismjs/components/prism-yaml.js?raw"
import prismJavaSrc from "prismjs/components/prism-java.js?raw"
import prismLogSrc from "prismjs/components/prism-log.js?raw"
import prismPropertiesSrc from "prismjs/components/prism-properties.js?raw"

function registerPrismLanguages(): void {
  const run = (source: string) => {
    // Компоненты ожидают объект Prism либо в параметре, либо в глобале.
    // eslint-disable-next-line no-new-func
    new Function("Prism", "globalThis", "window", source)(Prism, globalThis, globalThis)
  }
  for (const src of [prismJsonSrc, prismYamlSrc, prismJavaSrc, prismLogSrc, prismPropertiesSrc]) {
    try {
      run(src)
    } catch {
      // грамматика не загрузилась — подсветка откатится к plaintext
    }
  }
}
registerPrismLanguages()

function JavaIcon({ className }: { className?: string }) {
  return (
    <svg data-ui="server-files-tab-svg-1" data-icon="server-files-tab-svg-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path data-ui="server-files-tab-path-1" d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path data-ui="server-files-tab-path-2" d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
      <path data-ui="server-files-tab-path-3" d="M10 10c-1 -1 1 -1 0 -2" />
      <path data-ui="server-files-tab-path-4" d="M12 10c-1 -1 1 -1 0 -2" />
      <path data-ui="server-files-tab-path-5" d="M8 12h6v4a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
      <path data-ui="server-files-tab-path-6" d="M14 13h1a1.5 1.5 0 0 1 0 3h-1" />
    </svg>
  )
}

interface FilesTabProps {
  serverId: string
}

interface EditorTab {
  path: string
  content: string
  saved: boolean
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function getFileIcon(entry: McFsEntry) {
  if (entry.isDir) return IconFolder
  const name = entry.name.toLowerCase()
  if (name.endsWith(".jar")) return JavaIcon
  if (name.endsWith(".java")) return JavaIcon
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return IconFileCode
  if (name.endsWith(".json")) return IconFileCode
  if (name.endsWith(".properties")) return IconFileCode
  if (name.endsWith(".cfg") || name.endsWith(".conf")) return IconFileCode
  if (name.endsWith(".log")) return IconFileText
  if (name.endsWith(".txt")) return IconFileText
  return IconFile
}

function getFileIconColor(entry: McFsEntry): string {
  if (entry.isDir) return "text-primary/70"
  const name = entry.name.toLowerCase()
  if (name.endsWith(".jar") || name.endsWith(".java")) return "text-primary"
  return "text-muted-foreground"
}

const TEXT_EXTENSIONS = new Set([".yml", ".yaml", ".json", ".txt", ".log", ".properties", ".cfg", ".conf"])

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

function getLanguage(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".json")) return "json"
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml"
  if (lower.endsWith(".properties")) return "properties"
  if (lower.endsWith(".java")) return "java"
  if (lower.endsWith(".log")) return "log"
  return "plaintext"
}

function highlightCode(code: string, lang: string): string {
  try {
    if (lang === "plaintext") {
      return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }
    const grammar = Prism.languages[lang]
    if (grammar) {
      return Prism.highlight(code, grammar, lang)
    }
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  } catch {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

export function FilesTab({ serverId }: FilesTabProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<McFsEntry[]>([])
  const [currentPath, setCurrentPath] = useState("")
  const [loading, setLoading] = useState(true)
  const contentEnter = useContentEnter(!loading)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  // Editor tabs
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: McFsEntry } | null>(null)

  // Rename
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  // New item
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null)
  const [creatingName, setCreatingName] = useState("")
  const createInputRef = useRef<HTMLInputElement>(null)

  // Resizable split
  const [splitPos, setSplitPos] = useState(50)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeTabData = useMemo(() => tabs.find(t => t.path === activeTab) ?? null, [tabs, activeTab])

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError(null)
    try {
      const items = await window.electronAPI?.mcServerFsList(serverId, dirPath)
      setEntries(items ?? [])
    } catch (err: any) {
      setError(err.message ?? "Failed to load directory")
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    loadDirectory(currentPath)
  }, [currentPath, loadDirectory])

  useEffect(() => {
    if (renamingEntry !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 50)
    }
  }, [renamingEntry])

  useEffect(() => {
    if (creatingType !== null) {
      setTimeout(() => createInputRef.current?.focus(), 50)
    }
  }, [creatingType])

  const pathParts = useMemo(() => {
    if (!currentPath) return []
    return currentPath.split(/[/\\]/).filter(Boolean)
  }, [currentPath])

  const navigateTo = useCallback((index: number) => {
    if (index < 0) {
      setCurrentPath("")
      return
    }
    const parts = currentPath.split(/[/\\]/).filter(Boolean)
    setCurrentPath(parts.slice(0, index + 1).join("/"))
  }, [currentPath])

  const openFile = useCallback(async (fileName: string) => {
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
    if (!isTextFile(fileName)) return

    const existing = tabs.find(t => t.path === filePath)
    if (existing) {
      setActiveTab(filePath)
      return
    }

    setEditorLoading(true)
    setEditorError(null)
    try {
      const content = await window.electronAPI?.mcServerFsRead(serverId, filePath)
      if (content === null) {
        setEditorError("File not found")
        return
      }
      setTabs(prev => [...prev, { path: filePath, content: content ?? "", saved: true }])
      setActiveTab(filePath)
    } catch (err: any) {
      setEditorError(err.message ?? "Failed to read file")
    } finally {
      setEditorLoading(false)
    }
  }, [serverId, currentPath, tabs])

  const closeTab = useCallback((filePath: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setTabs(prev => {
      const next = prev.filter(t => t.path !== filePath)
      if (activeTab === filePath) {
        const idx = prev.findIndex(t => t.path === filePath)
        const newActive = next.length > 0 ? next[Math.min(idx, next.length - 1)].path : null
        setTimeout(() => setActiveTab(newActive), 0)
      }
      return next
    })
  }, [activeTab])

  const handleTabClick = useCallback((filePath: string) => {
    setActiveTab(filePath)
  }, [])

  const handleContentChange = useCallback((value: string) => {
    if (!activeTab) return
    setTabs(prev => prev.map(t => t.path === activeTab ? { ...t, content: value, saved: false } : t))
    setEditorError(null)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      handleSave(activeTab, value)
    }, 1200)
  }, [activeTab])

  const handleSave = useCallback(async (filePath: string, content: string) => {
    try {
      await window.electronAPI?.mcServerFsWrite(serverId, filePath, content)
      setTabs(prev => prev.map(t => t.path === filePath ? { ...t, saved: true } : t))
    } catch (err: any) {
      setEditorError(err.message ?? "Failed to save file")
    }
  }, [serverId])

  const handleDelete = useCallback(async (entry: McFsEntry) => {
    const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name
    try {
      await window.electronAPI?.mcServerFsDelete(serverId, filePath)
      closeTab(filePath)
      loadDirectory(currentPath)
    } catch (err: any) {
      setError(err.message ?? "Failed to delete")
    }
    setContextMenu(null)
  }, [serverId, currentPath, loadDirectory, closeTab])

  const handleRename = useCallback(async () => {
    if (!renamingEntry || !renameValue.trim()) return
    const oldPath = currentPath ? `${currentPath}/${renamingEntry}` : renamingEntry
    const newPath = currentPath ? `${currentPath}/${renameValue.trim()}` : renameValue.trim()
    try {
      await window.electronAPI?.mcServerFsRename(serverId, oldPath, newPath)
      setTabs(prev => prev.map(t => t.path === oldPath ? { ...t, path: newPath } : t))
      if (activeTab === oldPath) setActiveTab(newPath)
      loadDirectory(currentPath)
    } catch (err: any) {
      setError(err.message ?? "Failed to rename")
    }
    setRenamingEntry(null)
  }, [serverId, currentPath, renamingEntry, renameValue, activeTab, loadDirectory])

  const handleCreate = useCallback(async () => {
    if (!creatingType || !creatingName.trim()) return
    const fullPath = currentPath ? `${currentPath}/${creatingName.trim()}` : creatingName.trim()
    try {
      if (creatingType === "folder") {
        await window.electronAPI?.mcServerFsMkdir(serverId, fullPath)
      } else {
        await window.electronAPI?.mcServerFsWrite(serverId, fullPath, "")
      }
      loadDirectory(currentPath)
    } catch (err: any) {
      setError(err.message ?? "Failed to create")
    }
    setCreatingType(null)
  }, [serverId, currentPath, creatingType, creatingName, loadDirectory])

  const handleEntryClick = useCallback((entry: McFsEntry) => {
    if (entry.isDir) {
      const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
      setCurrentPath(newPath)
    } else {
      openFile(entry.name)
    }
  }, [currentPath, openFile])

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().includes(q))
  }, [entries, search])

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredEntries])

  const totalSize = useMemo(() => {
    return entries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0)
  }, [entries])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setSplitPos(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  const hasTabs = tabs.length > 0

  return (
    <div data-ui="server-files-tab-div-1" data-component="files-tab" ref={containerRef} className={`flex h-full ${contentEnter ?? ""}`}>
      {/* File browser panel */}
      <div data-ui="server-files-tab-div-2" className={cn("flex flex-col h-full overflow-hidden", hasTabs ? "border-r border-border" : "w-full")} style={hasTabs ? { width: `${splitPos}%` } : undefined}>
        {/* Toolbar */}
        <div data-ui="server-files-tab-div-3" className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <button data-ui="server-files-tab-button-1"
            onClick={() => navigateTo(-1)}
            disabled={!currentPath}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              currentPath
                ? "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "text-muted-foreground/30 cursor-not-allowed"
            )}
            title={t("files.root")}
          >
            <IconHome className="w-4 h-4" />
          </button>
          <button data-ui="server-files-tab-button-2"
            onClick={() => {
              const parts = currentPath.split(/[/\\]/).filter(Boolean)
              if (parts.length > 0) {
                parts.pop()
                setCurrentPath(parts.join("/"))
              }
            }}
            disabled={!currentPath}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              currentPath
                ? "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "text-muted-foreground/30 cursor-not-allowed"
            )}
            title={t("files.back")}
          >
            <IconArrowLeft className="w-4 h-4" />
          </button>
          <button data-ui="server-files-tab-button-3"
            onClick={() => loadDirectory(currentPath)}
            className="p-1.5 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t("files.refresh")}
          >
            <IconRefresh className="w-4 h-4" />
          </button>

          {/* Breadcrumb */}
          <div data-ui="server-files-tab-div-4" className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
            <button data-ui="server-files-tab-button-4"
              onClick={() => navigateTo(-1)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted/50 flex-shrink-0"
            >
              /
            </button>
            {pathParts.map((part, i) => (
              <span data-ui="server-files-tab-span-1" key={i} className="flex items-center flex-shrink-0">
                <IconChevronRight className="w-3 h-3 text-muted-foreground/50" />
                <button data-ui="server-files-tab-button-5"
                  onClick={() => navigateTo(i)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted/50 truncate max-w-[120px]"
                >
                  {part}
                </button>
              </span>
            ))}
          </div>

          <div data-ui="server-files-tab-div-5" className="relative flex-shrink-0">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input data-ui="server-files-tab-input-1"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("files.search")}
              className="w-36 pl-8 pr-2 py-1.5 rounded-lg bg-muted/50 border border-border text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div data-ui="server-files-tab-div-6" className="flex items-center gap-1 flex-shrink-0">
            <button data-ui="server-files-tab-button-6"
              onClick={() => { setCreatingType("folder"); setCreatingName("") }}
              className="p-1.5 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("files.newFolder")}
            >
              <IconFolder className="w-4 h-4" />
            </button>
            <button data-ui="server-files-tab-button-7"
              onClick={() => { setCreatingType("file"); setCreatingName("") }}
              className="p-1.5 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("files.newFile")}
            >
              <IconPlus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Info bar */}
        <div data-ui="server-files-tab-div-7" className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/10 text-[11px] text-muted-foreground">
          <span data-ui="server-files-tab-span-2">{entries.length} {t("files.items")}</span>
          <span data-ui="server-files-tab-span-3">{formatSize(totalSize)}</span>
        </div>

        {/* Create input */}
        {creatingType && (
          <div data-ui="server-files-tab-div-8" className="flex items-center gap-2 px-4 py-2 border-b border-border bg-primary/5">
            <span data-ui="server-files-tab-span-4" className="text-xs text-muted-foreground">{creatingType === "folder" ? "📁" : "📄"}</span>
            <input data-ui="server-files-tab-input-2"
              ref={createInputRef}
              value={creatingName}
              onChange={e => setCreatingName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") setCreatingType(null)
              }}
              placeholder={creatingType === "folder" ? t("files.folderName") : t("files.fileName")}
              className="flex-1 px-2 py-1 rounded bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary"
            />
            <button data-ui="server-files-tab-button-8" onClick={handleCreate} className="p-1 rounded bg-primary/20 hover:bg-primary/30 text-primary transition-colors">
              <IconCheck className="w-4 h-4" />
            </button>
            <button data-ui="server-files-tab-button-9" onClick={() => setCreatingType(null)} className="p-1 rounded bg-muted/50 hover:bg-muted text-muted-foreground transition-colors">
              <IconX className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div data-ui="server-files-tab-div-9" className="mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* File list */}
        <div data-ui="server-files-tab-div-10" className="flex-1 overflow-y-auto">
          {loading ? (
            <div data-ui="server-files-tab-div-11" className="flex items-center justify-center h-full">
              <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : sortedEntries.length === 0 ? (
            <EmptyState
              variant={search ? "search" : "empty"}
              title={search ? t("files.noResults") : t("files.empty")}
              className="h-full"
            />
          ) : (
            <div data-ui="server-files-tab-div-12" className="divide-y divide-border/50">
              {sortedEntries.map(entry => {
                const Icon = getFileIcon(entry)
                const iconColor = getFileIconColor(entry)
                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
                const isRenaming = renamingEntry === entry.name
                const isTabOpen = tabs.some(t => t.path === entryPath)
                const isActive = activeTab === entryPath

                return (
                  <div data-ui="server-files-tab-div-13"
                    key={entry.name}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors group cursor-pointer",
                      isActive && "bg-primary/5",
                      isTabOpen && !isActive && "bg-muted/20"
                    )}
                    onClick={() => !isRenaming && handleEntryClick(entry)}
                    onContextMenu={e => {
                      e.preventDefault()
                      if (!isRenaming) setContextMenu({ x: e.clientX, y: e.clientY, entry })
                    }}
                  >
                    <Icon
                      className={cn("w-5 h-5 flex-shrink-0", iconColor)}
                      strokeWidth={1.5}
                    />
                    <div data-ui="server-files-tab-div-14" className="flex-1 min-w-0">
                      {isRenaming ? (
                        <div data-ui="server-files-tab-div-15" className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input data-ui="server-files-tab-input-3"
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") handleRename()
                              if (e.key === "Escape") setRenamingEntry(null)
                            }}
                            onBlur={handleRename}
                            className="flex-1 px-1.5 py-0.5 rounded bg-muted border border-border text-foreground text-sm focus:outline-none focus:border-primary"
                          />
                          <button data-ui="server-files-tab-button-10" onClick={handleRename} className="p-0.5 rounded hover:bg-primary/20 text-primary">
                            <IconCheck className="w-3.5 h-3.5" />
                          </button>
                          <button data-ui="server-files-tab-button-11" onClick={() => setRenamingEntry(null)} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
                            <IconX className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span data-ui="server-files-tab-span-5" className="text-sm text-foreground truncate block">{entry.name}</span>
                      )}
                    </div>
                    {!entry.isDir && (
                      <span data-ui="server-files-tab-span-6" className="text-[11px] text-muted-foreground/60 flex-shrink-0 font-mono">
                        {formatSize(entry.size)}
                      </span>
                    )}
                    {!isRenaming && (
                      <div data-ui="server-files-tab-div-16" className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button data-ui="server-files-tab-button-12"
                          onClick={e => {
                            e.stopPropagation()
                            setRenamingEntry(entry.name)
                            setRenameValue(entry.name)
                          }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                          title={t("files.rename")}
                        >
                          <IconPencil className="w-3.5 h-3.5" />
                        </button>
                        <button data-ui="server-files-tab-button-13"
                          onClick={e => { e.stopPropagation(); handleDelete(entry) }}
                          className="p-1 rounded hover:bg-destructive/10 text-destructive"
                          title={t("files.delete")}
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Editor panel */}
      {hasTabs && (
        <>
          {/* Drag handle */}
          <div data-ui="server-files-tab-div-17"
            onMouseDown={handleDragStart}
            className="w-1 h-full cursor-col-resize flex-shrink-0 group relative hover:bg-primary/30 transition-colors"
          >
            <div data-ui="server-files-tab-div-18" className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary transition-colors" />
          </div>
          <div data-ui="server-files-tab-div-19" className="flex flex-col h-full overflow-hidden" style={{ width: `${100 - splitPos}%` }}>
            {/* Tabs bar */}
            <div data-ui="server-files-tab-div-20" className="flex items-center overflow-x-auto bg-muted/20 border-b border-border min-h-[36px]">
              {tabs.map(tab => {
                const isActive = tab.path === activeTab
                const fileName = tab.path.split("/").pop() ?? tab.path
                const isJava = fileName.endsWith(".jar") || fileName.endsWith(".java")
                const iconColor = isJava ? "text-primary" : "text-muted-foreground"
                return (
                  <div data-ui="server-files-tab-div-21"
                    key={tab.path}
                    className={cn(
                      "flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 border-r border-border cursor-pointer transition-colors group flex-shrink-0 min-w-0 max-w-[180px] hover:bg-muted/50",
                      isActive && "bg-background"
                    )}
                    onClick={() => handleTabClick(tab.path)}
                  >
                    {isJava ? (
                      <JavaIcon className={cn("w-3.5 h-3.5 flex-shrink-0", iconColor)} />
                    ) : (
                      <IconFile className={cn("w-3.5 h-3.5 flex-shrink-0", iconColor)} />
                    )}
                    <span data-ui="server-files-tab-span-7" className={cn("text-xs truncate", isActive ? "text-foreground font-medium" : "text-muted-foreground")}>
                      {fileName}
                    </span>
                    {!tab.saved && (
                      <div data-ui="server-files-tab-div-22" className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    )}
                    <button data-ui="server-files-tab-button-14"
                      onClick={e => { e.stopPropagation(); closeTab(tab.path) }}
                      className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors flex-shrink-0"
                    >
                      <IconX className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>

            {editorError && (
              <div data-ui="server-files-tab-div-23" className="mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {editorError}
              </div>
            )}

            {/* Editor content */}
            <div data-ui="server-files-tab-div-24" className="flex-1 min-h-0 overflow-auto">
              {editorLoading ? (
                <div data-ui="server-files-tab-div-25" className="flex items-center justify-center h-full">
                  <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : activeTabData ? (
                <Editor
                  value={activeTabData.content}
                  onValueChange={handleContentChange}
                  highlight={code => highlightCode(code, getLanguage(activeTabData.path))}
                  padding={16}
                  className="code-editor-wrapper font-mono text-sm leading-relaxed"
                  textareaClassName="!outline-none !bg-transparent !overflow-auto"
                  style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
                    fontSize: "13px",
                    lineHeight: "1.6",
                    minHeight: "100%",
                  }}
                />
              ) : (
                <div data-ui="server-files-tab-div-26" className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("files.noFileOpen")}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Context menu overlay */}
      {contextMenu && (
        <>
          <div data-ui="server-files-tab-div-27"
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
          />
          <div data-ui="server-files-tab-div-28"
            className="fixed z-50 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {!contextMenu.entry.isDir && isTextFile(contextMenu.entry.name) && (
              <button data-ui="server-files-tab-button-15"
                onClick={() => { openFile(contextMenu.entry.name); setContextMenu(null) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
              >
                <IconFileCode className="w-4 h-4 text-muted-foreground" />
                {t("files.edit")}
              </button>
            )}
            <button data-ui="server-files-tab-button-16"
              onClick={() => {
                setRenamingEntry(contextMenu.entry.name)
                setRenameValue(contextMenu.entry.name)
                setContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <IconPencil className="w-4 h-4 text-muted-foreground" />
              {t("files.rename")}
            </button>
            <button data-ui="server-files-tab-button-17"
              onClick={() => handleDelete(contextMenu.entry)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <IconTrash className="w-4 h-4" />
              {t("files.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
