import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export async function aiListSessions(): Promise<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>> {
  if (!isDbAvailable()) return []
  return queryAll<{ id: string; title: string; createdAt: number; updatedAt: number }>(
    "SELECT id, title, createdAt, updatedAt FROM ai_sessions ORDER BY updatedAt DESC"
  )
}

export async function aiCreateSession(id: string, title: string): Promise<void> {
  if (!isDbAvailable()) return
  const now = Date.now()
  run("INSERT INTO ai_sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)", [id, title, now, now])
  persistDatabase()
}

export async function aiRenameSession(id: string, title: string): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE ai_sessions SET title = ?, updatedAt = ? WHERE id = ?", [title, Date.now(), id])
  persistDatabase()
}

export async function aiDeleteSession(id: string): Promise<void> {
  if (!isDbAvailable()) return
  run("DELETE FROM ai_messages WHERE sessionId = ?", [id])
  run("DELETE FROM ai_sessions WHERE id = ?", [id])
  persistDatabase()
}

export async function aiListMessages(sessionId: string): Promise<Array<{ id: string; role: string; content: string; createdAt: number }>> {
  if (!isDbAvailable()) return []
  return queryAll<{ id: string; role: string; content: string; createdAt: number }>(
    "SELECT id, role, content, createdAt FROM ai_messages WHERE sessionId = ? ORDER BY createdAt ASC",
    [sessionId]
  )
}

export async function aiAddMessage(id: string, sessionId: string, role: string, content: string): Promise<void> {
  if (!isDbAvailable()) return
  run("INSERT INTO ai_messages (id, sessionId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)", [id, sessionId, role, content, Date.now()])
  run("UPDATE ai_sessions SET updatedAt = ? WHERE id = ?", [Date.now(), sessionId])
  persistDatabase()
}
