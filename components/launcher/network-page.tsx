import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import Picker from "@emoji-mart/react"
import data from "@emoji-mart/data"
import {
  IconNetwork, IconPlus, IconLogin, IconLogout, IconUsers,
  IconCopy, IconRefresh, IconLoader2, IconWorld, IconChevronLeft,
  IconMessageCircle, IconTrash, IconCrown, IconUserOff, IconMoodSmile,
  IconSend, IconServer, IconUser,
  IconShield, IconBroadcast, IconRouter,
} from "@tabler/icons-react"
import type {
  P2PRoom, P2PRoomMember, P2PConnState, P2PLogEntry, P2PChatMessage,
} from "@xnlc/types"
import { NetworkAuthModal, NetworkCreateModal, NetworkJoinModal } from "./network-modals"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"

const api = typeof window !== "undefined" ? window.electronAPI : undefined
const MC_SKIN_API = "https://mcskinapi-three.vercel.app"

export function NetworkPage() {
  const { t } = useTranslation()
  const { activeAccount } = useAccounts()
  const [user, setUser] = useState<{ login: string; userId: string } | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [rooms, setRooms] = useState<P2PRoom[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [formName, setFormName] = useState("")
  const [formPassword, setFormPassword] = useState("")
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState("")
  const [room, setRoom] = useState<P2PRoom | null>(null)
  const [connState, setConnState] = useState<P2PConnState>("disconnected")
  const [connError, setConnError] = useState<string | null>(null)
  const [members, setMembers] = useState<P2PRoomMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [playerName, setPlayerName] = useState("")
  const [logs, setLogs] = useState<P2PLogEntry[]>([])
  const [logFilter, setLogFilter] = useState<"all" | "info" | "warn" | "error">("all")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [chatMessages, setChatMessages] = useState<P2PChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [roomTab, setRoomTab] = useState<"chat" | "logs">("chat")
  const roomRef = useRef(room)
  roomRef.current = room
  const chatInputRef = useRef(chatInput)
  chatInputRef.current = chatInput

  const isOnline = connState === "connected"
  const isConnecting = connState === "connecting"
  const filteredLogs = logFilter === "all" ? logs : logs.filter((l) => l.level === logFilter)

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [logs])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chatMessages])

  useEffect(() => {
    if (!api) return
    api.p2pGetMe().then((r) => {
      if (r.success && r.login) setUser({ login: r.login, userId: r.userId || "" })
    })
    api.p2pGetState().then((s) => {
      setConnState(s.state)
      if (s.groupId && s.groupName)
        setRoom({ id: s.groupId, name: s.groupName, isHost: s.role === "host", createdAt: 0 })
      if (s.playerName) setPlayerName(s.playerName)
    })
    api.getSetting("playerName").then((v) => { if (v) setPlayerName(v) })
  }, [])

  useEffect(() => {
    if (!api) return
    const u = [
      api.onP2PState((s) => setConnState(s)),
      api.onP2PLog((e) => setLogs((p) => [...p.slice(-200), e])),
      api.onP2PChat((m) => setChatMessages((p) => [...p.slice(-200), m])),
    ]
    return () => u.forEach((fn) => fn())
  }, [])

  const fetchRooms = useCallback(async () => {
    if (!api) return
    setLoadingRooms(true)
    try { const r = await api.p2pListRooms(); if (r.success && r.rooms) setRooms(r.rooms) }
    finally { setLoadingRooms(false) }
  }, [])

  const fetchMembers = useCallback(async () => {
    const rm = roomRef.current
    if (!api || !rm) return
    setLoadingMembers(true)
    try { const r = await api.p2pListMembers(rm.id); if (r.success && r.members) setMembers(r.members) }
    finally { setLoadingMembers(false) }
  }, [])

  useEffect(() => { if (user) fetchRooms() }, [user, fetchRooms])
  useEffect(() => { if (room) fetchMembers() }, [room, fetchMembers])
  useEffect(() => { if (!room) return; const t = setInterval(fetchMembers, 5000); return () => clearInterval(t) }, [room, fetchMembers])

  const doConnect = useCallback(async (role: "host" | "joiner", target: P2PRoom) => {
    if (!api) return
    setLogs([]); setChatMessages([]); setConnError(null)
    // playerName is taken from the JWT token on the main process side,
    // so we pass an empty string here — it will be overridden by the login.
    const res = await api.p2pStart(role, target.id, target.name, "")
    if (!res.success) setConnError(res.error || "Connection failed")
  }, [])

  const doDisconnect = useCallback(async () => {
    if (!api) return
    await api.p2pStop()
    setConnError(null); setChatMessages([])
  }, [])

  const handleBack = useCallback(async () => {
    if (connState !== "disconnected") await doDisconnect()
    setRoom(null); setMembers([]); setLogs([]); setChatMessages([])
    setConnError(null); setConnState("disconnected")
  }, [connState, doDisconnect])

  const handleDeleteRoom = useCallback(async () => {
    if (!api || !roomRef.current) return
    await doDisconnect()
    await api.p2pDeleteRoom(roomRef.current.id)
    setRoom(null); setMembers([]); setLogs([]); setChatMessages([])
    setConnError(null); setConnState("disconnected")
  }, [doDisconnect])

  const handleLeaveRoom = useCallback(async () => {
    if (!api || !roomRef.current) return
    const gid = roomRef.current.id
    await doDisconnect()
    try { await api.p2pLeaveRoom(gid) } catch { /* leave even on error */ }
    setRoom(null); setMembers([]); setLogs([]); setChatMessages([])
    setConnError(null); setConnState("disconnected")
  }, [doDisconnect])

  const handleRetry = useCallback(() => {
    const rm = roomRef.current
    if (rm) doConnect(rm.isHost ? "host" : "joiner", rm)
  }, [doConnect])

  const handleSendChat = useCallback(async () => {
    if (!api || !chatInputRef.current.trim()) return
    const msg = chatInputRef.current.trim()
    setChatInput("")
    await api.p2pSendChat(msg)
  }, [])

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!api || !formName.trim()) return
    setFormLoading(true); setFormError("")
    try {
      const res = await api.p2pCreateRoom(formName.trim(), formPassword || undefined)
      if (!res.success) throw new Error(res.error || "Failed")
      const nr: P2PRoom = { id: res.groupId || "", name: res.name || formName.trim(), isHost: true, createdAt: Date.now() }
      setRoom(nr); setShowCreate(false); setFormName(""); setFormPassword("")
      doConnect("host", nr)
    } catch (err) { setFormError(err instanceof Error ? err.message : String(err)) }
    finally { setFormLoading(false) }
  }

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!api || !formName.trim()) return
    setFormLoading(true); setFormError("")
    try {
      const res = await api.p2pJoinRoom(formName.trim(), formPassword || undefined)
      if (!res.success) throw new Error(res.error || "Failed")
      const nr: P2PRoom = { id: res.groupId || "", name: res.name || formName.trim(), isHost: false, createdAt: Date.now() }
      setRoom(nr); setShowJoin(false); setFormName(""); setFormPassword("")
      doConnect("joiner", nr)
    } catch (err) { setFormError(err instanceof Error ? err.message : String(err)) }
    finally { setFormLoading(false) }
  }

  const handleTransferHost = useCallback(async (userId: string) => {
    if (!api || !roomRef.current) return
    const r = await api.p2pTransferHost(roomRef.current.id, userId)
    if (r.success) { setRoom((p) => p ? { ...p, isHost: false } : p); fetchMembers() }
  }, [fetchMembers])

  const handleKickMember = useCallback(async (userId: string) => {
    if (!api || !roomRef.current) return
    await api.p2pKickMember(roomRef.current.id, userId)
    fetchMembers()
  }, [fetchMembers])

  // ═══════════════════════════════════════════
  // AUTH VIEW
  // ═══════════════════════════════════════════
  if (!user) {
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-4">
        <div className="flex-1 min-h-0 relative overflow-hidden rounded-2xl bg-card border border-border flex flex-col items-center justify-center gap-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.65_0.22_40/0.06)_0%,transparent_70%)]" />
          <div className="relative z-10 flex flex-col items-center text-center px-4">
            <div className="relative mb-2">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 flex items-center justify-center">
                <IconNetwork className="w-11 h-11 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center">
                <IconShield className="w-3.5 h-3.5 text-primary/60" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{t("network.title")}</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm leading-relaxed">{t("network.noXnAccountDesc")}</p>
            <button onClick={() => setShowAuth(true)}
              className="mt-6 px-8 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all shadow-[0_0_25px_var(--glow-primary)] active:scale-[0.98]">
              {t("network.createXnAccount")}
            </button>
          </div>
        </div>
        {showAuth && <NetworkAuthModal isOpen onClose={() => setShowAuth(false)} onSuccess={() => {
          api?.p2pGetMe().then((r) => { if (r.success && r.login) setUser({ login: r.login, userId: r.userId || "" }) })
        }} />}
      </div>
    )
  }

  // ═══════════════════════════════════════════
  // ROOM VIEW
  // ═══════════════════════════════════════════
  if (room) {
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {/* Status bar */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-border px-5 py-3 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.03] to-transparent pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={handleBack}
                className="p-2 -ml-2 rounded-xl hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                <IconChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">{room.name}</h2>
                    {room.isHost && (
                      <span className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary uppercase tracking-widest">{t("network.host")}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isConnecting ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <IconLoader2 className="w-4 h-4 text-amber-400 animate-spin" />
                  <span className="text-xs font-medium text-amber-400">{t("network.connecting")}</span>
                </div>
              ) : isOnline ? (
                <button onClick={doDisconnect}
                  className="px-4 py-2 rounded-xl bg-destructive/10 hover:bg-destructive/15 border border-destructive/20 text-destructive text-xs font-semibold transition-all">
                  {t("network.disconnect")}
                </button>
              ) : (
                <button onClick={handleRetry}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-all shadow-[0_0_15px_var(--glow-primary)]">
                  {t("network.connect")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* Right: Tabs */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden rounded-2xl bg-card border border-border">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50 shrink-0">
              {(["chat", "logs"] as const).map((tab) => (
                <button key={tab} onClick={() => setRoomTab(tab)}
                  className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    roomTab === tab
                      ? "bg-primary/15 text-primary border border-primary/20"
                      : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/30 border border-transparent")}>
                  {tab === "chat" ? <IconMessageCircle className="w-4 h-4" /> : <IconServer className="w-4 h-4" />}
                  {tab === "chat" ? t("network.chat") : "Logs"}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1">
                {roomTab === "logs" && (
                  <div className="flex gap-0.5 bg-muted/20 rounded-lg p-0.5 mr-1">
                    {(["all", "info", "warn", "error"] as const).map((lv) => (
                      <button key={lv} onClick={() => setLogFilter(lv)}
                        className={cn("px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all",
                          logFilter === lv ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground/50 hover:text-foreground")}>
                        {lv}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => navigator.clipboard.writeText(`${room.name}\nID: ${room.id}`)}
                  className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors" title={t("network.copyInfo")}>
                  <IconCopy className="w-4 h-4" />
                </button>
                <button onClick={room.isHost ? handleDeleteRoom : handleLeaveRoom}
                  className="p-2 rounded-xl hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive transition-colors" title={room.isHost ? t("network.leave") : t("network.leave")}>
                  <IconTrash className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {roomTab === "chat" ? (
                <>
                  {/* Members sidebar */}
                  <div className="w-1/4 min-w-[140px] shrink-0 border-r border-border/50 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 shrink-0">
                      <div className="flex items-center gap-2">
                        <IconUsers className="w-3.5 h-3.5 text-muted-foreground/60" />
                        <span className="text-xs font-semibold text-foreground">{t("network.members")}</span>
                        <span className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-medium text-muted-foreground">{members.length}</span>
                      </div>
                      <button onClick={fetchMembers} disabled={loadingMembers}
                        className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-40">
                        <IconRefresh className={cn("w-3 h-3", loadingMembers && "animate-spin")} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-3 py-1.5">
                      {members.length === 0 && !loadingMembers ? (
                        <p className="text-[11px] text-muted-foreground/30 text-center py-6">{t("network.noNetworks")}</p>
                      ) : (
                        <div className="space-y-0.5">
                          {members.map((m) => (
                            <div key={m.id}
                              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/30 transition-all group">
                              <div className="relative shrink-0">
                                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 overflow-hidden">
                                  <img src={`${MC_SKIN_API}/avatar/${encodeURIComponent(m.login)}`} alt="" className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("hidden") }} />
                                  <span className="text-[11px] font-bold text-primary" hidden>{m.login[0]?.toUpperCase()}</span>
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-orange-500 border-[1.5px] border-card" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">{m.login}</p>
                                {m.isHost && (
                                  <p className="text-[9px] text-primary/70 font-medium">{t("network.host")}</p>
                                )}
                              </div>
                              {room.isHost && !m.isHost && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleTransferHost(m.id)}
                                    className="p-1 rounded-md hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors" title={t("network.host")}>
                                    <IconCrown className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => handleKickMember(m.id)}
                                    className="p-1 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors" title={t("network.kick")}>
                                    <IconUserOff className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chat area */}
                  <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                      {chatMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <IconMessageCircle className="w-8 h-8 text-muted-foreground/15 mb-2" />
                          <p className="text-[11px] text-muted-foreground/40">{t("network.chatEmpty")}</p>
                        </div>
                      ) : chatMessages.map((msg, i) => {
                        const isMe = msg.sender === activeAccount?.username
                        const avatarUrl = isMe && activeAccount
                          ? getAvatarUrl(activeAccount, activeAccount.username)
                          : `${MC_SKIN_API}/avatar/${encodeURIComponent(msg.sender)}`
                        return (
                          <div key={i} className="flex items-start gap-2.5 group">
                            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 shrink-0 mt-0.5 overflow-hidden">
                              <img src={avatarUrl} alt="" className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("hidden") }} />
                              <span className="text-[11px] font-bold text-primary" hidden>{msg.sender[0]?.toUpperCase()}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-[11px] font-bold text-primary">{msg.sender}</span>
                                {msg.ts ? <span className="text-[9px] text-muted-foreground/30">{new Date(msg.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                              </div>
                              <div className="inline-block max-w-full bg-primary/10 border border-primary/20 rounded-xl rounded-tl-sm px-3 py-2">
                                <p className="text-xs text-foreground/80 break-all leading-relaxed">{msg.message}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="px-3 py-2.5 border-t border-border/40 shrink-0">
                      <div className="flex items-center gap-2 bg-muted/20 rounded-xl border border-border/40 px-3 py-2 focus-within:border-primary/40 transition-colors">
                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors">
                          <IconMoodSmile className="w-4 h-4" />
                        </button>
                        {showEmojiPicker && (
                          <div className="absolute bottom-full left-0 mb-2 z-50 shadow-2xl rounded-xl overflow-hidden">
                            <Picker data={data}
                              onEmojiSelect={(emoji: { native: string }) => { setChatInput((p) => p + emoji.native); setShowEmojiPicker(false) }}
                              theme="dark" previewPosition="none" skinTonePosition="none" />
                          </div>
                        )}
                        <input value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSendChat() }}
                          placeholder={t("network.chatPlaceholder")}
                          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none min-w-0" />
                        <button onClick={handleSendChat} disabled={!chatInput.trim()}
                          className="p-1 rounded-lg text-primary/50 hover:text-primary disabled:opacity-25 transition-colors">
                          <IconSend className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Logs tab */
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed min-h-0">
                    {logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <IconServer className="w-8 h-8 text-muted-foreground/15 mb-2" />
                        <p className="text-[11px] text-muted-foreground/30">No logs yet</p>
                      </div>
                    ) : filteredLogs.map((log, i) => (
                      <div key={i} className={cn("flex gap-2 py-0.5",
                        log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-400" : log.level === "info" ? "text-emerald-400/70" : "text-muted-foreground/40")}>
                        <span className="shrink-0 select-none">{log.ts?.slice(11, 19)}</span>
                        <span className="truncate">{log.message}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {showCreate && <NetworkCreateModal isOpen onClose={() => setShowCreate(false)} onSubmit={handleCreateRoom}
          name={formName} setName={setFormName} password={formPassword} setPassword={setFormPassword} loading={formLoading} error={formError} />}
        {showJoin && <NetworkJoinModal isOpen onClose={() => setShowJoin(false)} onSubmit={handleJoinRoom}
          name={formName} setName={setFormName} password={formPassword} setPassword={setFormPassword} loading={formLoading} error={formError} />}
      </div>
    )
  }

  // ═══════════════════════════════════════════
  // ROOMS LIST (Hub)
  // ═══════════════════════════════════════════
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Room list */}
      <div className="relative overflow-hidden rounded-2xl bg-card border border-border flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <IconRouter className="w-4 h-4 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold text-foreground">{t("network.title")}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground/40">{rooms.length} {t("network.rooms")}</span>
            <button onClick={fetchRooms} disabled={loadingRooms}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-40">
              <IconRefresh className={cn("w-3.5 h-3.5", loadingRooms && "animate-spin")} />
            </button>
            <button onClick={async () => { await api?.p2pLogout(); setUser(null) }}
              className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground/50 hover:text-destructive transition-colors">
              <IconLogout className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loadingRooms && rooms.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <IconLoader2 className="w-7 h-7 text-muted-foreground/30 animate-spin" />
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/20 border border-border/30 flex items-center justify-center mb-4">
                <IconBroadcast className="w-7 h-7 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-medium text-muted-foreground/60">{t("network.noNetworks")}</p>
              <p className="text-xs text-muted-foreground/35 mt-1 max-w-xs">{t("network.selectNetworkDesc")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {rooms.map((r) => (
                <button key={r.id} onClick={() => setRoom(r)}
                  className="relative group overflow-hidden rounded-xl border border-border/50 bg-muted/10 hover:border-primary/40 hover:bg-muted/20 transition-all text-left p-4">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center">
                        <IconWorld className="w-4 h-4 text-primary/70" />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground/40 mt-1">
                      {r.isHost ? t("network.youAreHost") : t("network.host")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-5 py-4 border-t border-border/50 shrink-0 flex gap-3">
          <button onClick={() => { setShowCreate(true); setFormError(""); setFormName(""); setFormPassword("") }}
            className="flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-all shadow-[0_0_20px_var(--glow-primary)] active:scale-[0.98]">
            <IconPlus className="w-4 h-4" />{t("network.create")}
          </button>
          <button onClick={() => { setShowJoin(true); setFormError(""); setFormName(""); setFormPassword("") }}
            className="flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground text-sm font-semibold transition-all border border-border/50 active:scale-[0.98]">
            <IconLogin className="w-4 h-4" />{t("network.join")}
          </button>
        </div>
      </div>

      {showCreate && <NetworkCreateModal isOpen onClose={() => setShowCreate(false)} onSubmit={handleCreateRoom}
        name={formName} setName={setFormName} password={formPassword} setPassword={setFormPassword} loading={formLoading} error={formError} />}
      {showJoin && <NetworkJoinModal isOpen onClose={() => setShowJoin(false)} onSubmit={handleJoinRoom}
        name={formName} setName={setFormName} password={formPassword} setPassword={setFormPassword} loading={formLoading} error={formError} />}
    </div>
  )
}
