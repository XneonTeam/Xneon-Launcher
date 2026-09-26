import { queryAll, run, transactionImmediate, isDbAvailable, warnDbUnavailable } from "./core"

export async function aiListSessions(): Promise<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>> {
  if (!isDbAvailable()) { warnDbUnavailable("aiListSessions"); return [] }
  return queryAll<{ id: string; title: string; createdAt: number; updatedAt: number }>(
    "SELECT id, title, createdAt, updatedAt FROM ai_sessions ORDER BY updatedAt DESC"
  )
}

export async function aiCreateSession(id: string, title: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("aiCreateSession"); return }
  const now = Date.now()
  run("INSERT INTO ai_sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)", [id, title, now, now])
}

export async function aiRenameSession(id: string, title: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("aiRenameSession"); return }
  run("UPDATE ai_sessions SET title = ?, updatedAt = ? WHERE id = ?", [title, Date.now(), id])
}

export async function aiDeleteSession(id: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("aiDeleteSession"); return }
  // Сообщения и сессия удаляются одним коммитом — рвать пару нельзя.
  transactionImmediate(() => {
    run("DELETE FROM ai_messages WHERE sessionId = ?", [id])
    run("DELETE FROM ai_sessions WHERE id = ?", [id])
  })
}

export async function aiListMessages(sessionId: string): Promise<Array<{ id: string; role: string; content: string; createdAt: number }>> {
  if (!isDbAvailable()) { warnDbUnavailable("aiListMessages"); return [] }
  return queryAll<{ id: string; role: string; content: string; createdAt: number }>(
    "SELECT id, role, content, createdAt FROM ai_messages WHERE sessionId = ? ORDER BY createdAt ASC",
    [sessionId]
  )
}

export async function aiAddMessage(id: string, sessionId: string, role: string, content: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("aiAddMessage"); return }
  const now = Date.now()
  // Сообщение и bump updatedAt сессии — одна атомарная операция.
  transactionImmediate(() => {
    run("INSERT INTO ai_messages (id, sessionId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)", [id, sessionId, role, content, now])
    run("UPDATE ai_sessions SET updatedAt = ? WHERE id = ?", [now, sessionId])
  })
}
