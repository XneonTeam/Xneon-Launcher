import fs from "fs/promises"

export async function ensureDir(dir: string, mode?: number): Promise<string> {
  try {
    await fs.mkdir(dir, mode === undefined ? { recursive: true } : { recursive: true, mode })
  } catch {}
  return dir
}