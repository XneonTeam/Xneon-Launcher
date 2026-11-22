import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getDefaultLauncherDataRoot } from "./profile-path"
import { updatePublicKeys } from "./update-public-keys"
import { compareReleaseVersions, verifySignedWindowsUpdateManifest } from "./verified-update-manifest"
import type { PackageChannel, VerifiedUpdate } from "./verified-update-feed"

export type InstalledUpdateIdentity = { channel: PackageChannel; version: string; hash: string }
/** `sdk` — запись прежнего SDK-апдейтера: читается ради миграции, но не применяется. */
type SavedUpdate = {
  kind: "sdk" | "installer"; channel: PackageChannel; fromHash: string; fromChannel: PackageChannel
  manifest: string; signature: string; deferred: boolean
}
type UpdateState = { channel?: PackageChannel; pending?: SavedUpdate }
export type PendingUpdate = { kind: "installer"; deferred: boolean; path: string; update: VerifiedUpdate }

/** Выбор канала и отложенная установка независимы от БД и доступны до старта UI. */
export class UpdateStateStore {
  constructor(private readonly directory: string, private readonly keys = updatePublicKeys) {}

  private async directoryReady() {
    await mkdir(this.directory, { recursive: true })
    assert.ok((await lstat(this.directory)).isDirectory(), "Unsafe update state directory")
  }

  private async readJson(file: string, limit: number): Promise<unknown> {
    const info = await lstat(file)
    assert.ok(info.isFile() && info.size <= limit, "Invalid update state file")
    return JSON.parse(await readFile(file, "utf8"))
  }

  private async read(): Promise<UpdateState> {
    try {
      const value = await this.readJson(path.join(this.directory, "state.json"), 128 * 1024) as UpdateState
      assert.ok(value && typeof value === "object", "Invalid update state")
      assert.ok(value.channel === undefined || value.channel === "stable" || value.channel === "canary", "Invalid selected channel")
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw error
    }
  }

  private async write(value: UpdateState) {
    await this.directoryReady()
    const temporary = path.join(this.directory, `state-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 })
      await rename(temporary, path.join(this.directory, "state.json"))
    } finally { await rm(temporary, { force: true }) }
  }

  async getChannel(fallback: PackageChannel): Promise<PackageChannel> { return (await this.read()).channel ?? fallback }
  async selectChannel(channel: PackageChannel) { await this.write({ channel }) }
  async clearPending() { const state = await this.read(); await this.write({ channel: state.channel }) }

  private verify(saved: SavedUpdate) {
    assert.ok(saved.channel === "stable" || saved.channel === "canary", "Invalid pending channel")
    assert.ok(saved.kind === "sdk" || saved.kind === "installer", "Invalid pending update kind")
    assert.ok(typeof saved.manifest === "string" && saved.manifest.length <= 90_000 && typeof saved.signature === "string" && saved.signature.length <= 2048, "Invalid pending signature metadata")
    const manifestBytes = Buffer.from(saved.manifest, "base64")
    const signatureBytes = Buffer.from(saved.signature, "base64")
    const manifest = verifySignedWindowsUpdateManifest(manifestBytes, signatureBytes, this.keys, "0.0.0", saved.channel, saved.channel)
    return { manifest, manifestBytes, signatureBytes, archiveUrl: "" }
  }

  private async verifyInstaller(update: VerifiedUpdate) {
    const installer = JSON.parse(update.manifestBytes.toString("utf8")).installer
    assert.ok(installer && installer.file === `xneon-launcher-${update.manifest.version}-win-x64.exe`, "Invalid pending installer name")
    assert.ok(Number.isSafeInteger(installer.size) && installer.size > 0 && installer.size <= 512 * 1024 ** 2 && /^[a-f0-9]{64}$/.test(installer.sha256), "Invalid pending installer metadata")
    const file = path.join(this.directory, "installer.exe")
    const info = await lstat(file)
    assert.ok(info.isFile() && info.size === installer.size, "Pending installer size differs from signed manifest")
    assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), installer.sha256, "Pending installer hash differs from signed manifest")
    return file
  }

  async stage(local: InstalledUpdateIdentity, update: VerifiedUpdate, installer: string) {
    const pending: SavedUpdate = {
      kind: "installer", channel: update.manifest.channel, fromHash: local.hash, fromChannel: local.channel,
      manifest: update.manifestBytes.toString("base64"), signature: update.signatureBytes.toString("base64"), deferred: false,
    }
    const verified = this.verify(pending)
    assert.equal(verified.manifest.hash, update.manifest.hash, "Pending update hash mismatch")
    await this.directoryReady()
    const temporary = path.join(this.directory, `installer-${randomUUID()}.tmp`)
    try {
      await copyFile(installer, temporary)
      await rename(temporary, path.join(this.directory, "installer.exe"))
    } finally { await rm(temporary, { force: true }) }
    await this.verifyInstaller(verified)
    await this.write({ channel: pending.channel, pending })
  }

  async peek(local: InstalledUpdateIdentity): Promise<PendingUpdate | null> {
    const state = await this.read()
    const saved = state.pending
    if (!saved) return null
    // Прежняя SDK-схема Windows-обновлений больше не применяется: снимаем запись,
    // чтобы UI не показывал «скачано» для неприменимого обновления.
    if (saved.kind === "sdk") { await this.clearPending(); return null }
    const update = this.verify(saved)
    assert.equal(state.channel, saved.channel, "Pending update differs from selected channel")
    if (local.channel === update.manifest.channel && local.hash === update.manifest.hash) { await this.clearPending(); return null }
    assert.ok(saved.fromHash === local.hash && saved.fromChannel === local.channel, "Pending update belongs to a different installed build")
    if (saved.channel === local.channel) assert.ok(compareReleaseVersions(update.manifest.version, local.version) > 0, "Pending update must be newer than the installed version")
    const file = await this.verifyInstaller(update)
    return { kind: "installer", deferred: saved.deferred === true, update, path: file }
  }

  async defer(local: InstalledUpdateIdentity) {
    assert.ok(await this.peek(local), "No downloaded update to defer")
    const state = await this.read()
    assert.ok(state.pending, "No downloaded update to defer")
    state.pending.deferred = true
    await this.write(state)
  }
}

export const launcherUpdateState = new UpdateStateStore(path.join(getDefaultLauncherDataRoot(), "system-cache", "updates"))
