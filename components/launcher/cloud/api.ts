
const electron = typeof window !== "undefined" ? window.electronAPI : undefined
export const hasElectronAPI = !!electron

async function getCloudApiUrl(): Promise<string> {
  if (electron) {
    const stored = await electron.getSetting("cloudApiUrl")
    if (stored) return stored
  }
  return "http://localhost:3000/api"
}

export async function getCloudToken(): Promise<string | null> {
  if (electron) return (await electron.getSetting("cloud_token")) || null
  return localStorage.getItem("cloud_token")
}

export async function setCloudToken(token: string): Promise<void> {
  if (electron) await electron.setSetting("cloud_token", token)
  else localStorage.setItem("cloud_token", token)
}

export async function removeCloudToken(): Promise<void> {
  if (electron) await electron.setSetting("cloud_token", "")
  else localStorage.removeItem("cloud_token")
}

export async function cloudApiLogin(username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> {
  if (electron) return electron.cloudLogin(username, password)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
  const data = await res.json()
  if (!res.ok) return { success: false, error: data.error ?? data.detail ?? "Ошибка авторизации" }
  return { success: true, token: data.token ?? data.access_token }
}

export async function cloudApiRegister(username: string, password: string, email?: string): Promise<{ success: boolean; error?: string }> {
  if (electron) return electron.cloudRegister(username, password, email)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, email }) })
  const data = await res.json()
  if (!res.ok) return { success: false, error: data.error ?? data.detail ?? "Ошибка регистрации" }
  return { success: true }
}

export async function cloudApiGetUser(token: string): Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }> {
  if (electron) return electron.cloudGetUser(token)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Unauthorized" }
  const data = await res.json()
  return { success: true, user: data.user ?? data }
}

type CloudApiFile = {
  id: string
  name: string
  size: number
  type: string
  category?: string
  downloadUrl?: string
  icon?: string
  uploadedAt?: string
  originalName?: string
  _id?: string
}

export async function cloudApiGetFiles(token: string, category?: string): Promise<{ success: boolean; files?: CloudApiFile[]; error?: string }> {
  if (electron) return electron.cloudGetFiles(token, category)
  const baseUrl = await getCloudApiUrl()
  const params = category ? `?category=${category}` : ""
  const res = await fetch(`${baseUrl}/files${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Ошибка загрузки" }
  const data = await res.json()
  return { success: true, files: data.files ?? data ?? [] }
}

export async function cloudApiGetStorageInfo(token: string): Promise<{ used_bytes: number; limit_bytes: number; formatted_used: string; formatted_limit: string } | null> {
  if (electron) return electron.cloudGetStorageInfo(token)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/files/storage/info`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return res.json()
}

export async function cloudApiGetCategories(token: string): Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }> {
  if (electron) return electron.cloudGetCategories(token)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/files/categories`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false }
  const data = await res.json()
  return { success: true, categories: data.categories ?? {} }
}

export async function cloudApiDeleteFile(token: string, fileId: string): Promise<{ success: boolean; error?: string }> {
  if (electron) return electron.cloudDeleteFile(token, fileId)
  const baseUrl = await getCloudApiUrl()
  const res = await fetch(`${baseUrl}/files/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { success: false, error: "Ошибка удаления" }
  return { success: true }
}
