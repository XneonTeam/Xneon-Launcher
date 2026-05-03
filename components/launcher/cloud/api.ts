const API_BASE = "http://localhost:3000/api"

export const hasElectronAPI = typeof window !== "undefined" && typeof (window as any).electronAPI !== "undefined"

export async function getCloudToken(): Promise<string | null> {
  if (hasElectronAPI) return (await (window as any).electronAPI.getSetting("cloud_token")) || null
  return localStorage.getItem("cloud_token")
}

export async function setCloudToken(token: string): Promise<void> {
  if (hasElectronAPI) await (window as any).electronAPI.setSetting("cloud_token", token)
  else localStorage.setItem("cloud_token", token)
}

export async function removeCloudToken(): Promise<void> {
  if (hasElectronAPI) await (window as any).electronAPI.setSetting("cloud_token", "")
  else localStorage.removeItem("cloud_token")
}

export async function cloudApiLogin(username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudLogin(username, password)
  const res = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
  const data = await res.json()
  if (!res.ok) return { success: false, error: data.error || data.detail || "Ошибка авторизации" }
  return { success: true, token: data.access_token }
}

export async function cloudApiRegister(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudRegister(username, password)
  const res = await fetch(`${API_BASE}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
  const data = await res.json()
  if (!res.ok) return { success: false, error: data.error || data.detail || "Ошибка регистрации" }
  return { success: true }
}

export async function cloudApiGetUser(token: string): Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudGetUser(token)
  const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Unauthorized" }
  const data = await res.json()
  return { success: true, user: data.user || data }
}

export async function cloudApiGetFiles(token: string, category?: string): Promise<{ success: boolean; files?: any[]; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudGetFiles(token, category)
  const params = category ? `?category=${category}` : ""
  const res = await fetch(`${API_BASE}/files${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Ошибка загрузки" }
  const data = await res.json()
  return { success: true, files: data.files || data || [] }
}

export async function cloudApiGetStorageInfo(token: string): Promise<{ used_bytes: number; limit_bytes: number; formatted_used: string; formatted_limit: string } | null> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudGetStorageInfo(token)
  const res = await fetch(`${API_BASE}/files/storage/info`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.json()
}

export async function cloudApiGetCategories(token: string): Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudGetCategories(token)
  const res = await fetch(`${API_BASE}/files/categories`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false }
  const data = await res.json()
  return { success: true, categories: data.categories || {} }
}

export async function cloudApiDeleteFile(token: string, fileId: string): Promise<{ success: boolean; error?: string }> {
  if (hasElectronAPI) return (window as any).electronAPI.cloudDeleteFile(token, fileId)
  const res = await fetch(`${API_BASE}/files/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Ошибка удаления" }
  return { success: true }
}
