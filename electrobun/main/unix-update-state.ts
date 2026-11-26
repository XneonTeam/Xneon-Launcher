import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { expectedUpdateBaseUrl } from "./repository-identity"
import { updatePublicKeys } from "./update-public-keys"
import { compareReleaseVersions, verifySignedUnixUpdateManifest, type UnixUpdateFile, type UnixUpdateTarget } from "./update-manifest"
import { selectUnixUpdateArtifact, type UnixInstallation } from "./unix-update-installation"
import type { VerifiedUnixUpdate } from "./unix-update-feed"
import { syncUnixUpdateDirectory } from "./unix-update-transaction"

export type UnixInstalledBuild = { channel: "stable" | "canary"; version: string; hash: string }
type Pending = { from: UnixInstalledBuild; installation: UnixInstallation; manifest: string; signature: string; payload: string; deferred: boolean }
type State = { schemaVersion: 1; channel?: "stable" | "canary"; pending?: Pending }
export type PendingUnixUpdate = { update: VerifiedUnixUpdate; path: string; installation: UnixInstallation; deferred: boolean }

export async function verifyUnixUpdateFile(file: string, artifact: UnixUpdateFile) {
  const info = await lstat(file)
  assert.ok(info.isFile() && info.size === artifact.downloadSize, "Update file size differs from signed manifest")
  const hash = createHash("sha256")
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk)
  assert.equal(hash.digest("hex"), artifact.downloadSha256, "Update file SHA-256 differs from signed manifest")
}

/** Unix pending намеренно отделён от Windows NSIS/SDK state; подпись проверяется после каждого restart. */
export class UnixUpdateStateStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly directory: string, private readonly target: Omit<UnixUpdateTarget, "channel">,
    private readonly keys: Readonly<Record<string, string>> = updatePublicKeys) {}

  private async privateDirectory(create = false) {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const info = await lstat(this.directory)
    assert.ok(info.isDirectory(), "Unsafe Unix update state directory")
    if (process.platform !== "win32") assert.ok(info.uid === process.getuid!() && !(info.mode & 0o077), "Unix update state directory is not private")
  }
  private mutate<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation)
    this.queue = result.then(() => {}, () => {})
    return result
  }
  private async read(): Promise<State> {
    try {
      await this.privateDirectory()
      const file = path.join(this.directory, "state.json"), info = await lstat(file)
      assert.ok(info.isFile() && info.size <= 128 * 1024, "Invalid Unix update state file")
      const state = JSON.parse(await readFile(file, "utf8")) as State
      assert.ok(state?.schemaVersion === 1 && (state.channel === undefined || state.channel === "stable" || state.channel === "canary"), "Invalid Unix update state")
      return state
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1 }; throw error }
  }
  private async write(state: State) {
    await this.privateDirectory(true)
    const temporary = path.join(this.directory, `state-${randomBytes(16).toString("hex")}.tmp`)
    try {
      const handle = await open(temporary, "wx", 0o600)
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync() } finally { await handle.close() }
      await rename(temporary, path.join(this.directory, "state.json"))
      await syncUnixUpdateDirectory(this.directory); await syncUnixUpdateDirectory(path.dirname(this.directory))
    } finally { await rm(temporary, { force: true }) }
  }
  private payloadPath(file: unknown) {
    assert.ok(typeof file === "string" && /^payload-[a-f0-9]{32}$/.test(file), "Invalid pending update file")
    return path.join(this.directory, file)
  }
  private async removePayload(pending?: Pending) { if (pending) await rm(this.payloadPath(pending.payload), { force: true }) }
  async getChannel(fallback: UnixInstalledBuild["channel"]) { await this.queue; return (await this.read()).channel ?? fallback }
  selectChannel(channel: UnixInstalledBuild["channel"]) {
    return this.mutate(async () => {
      assert.ok(channel === "stable" || channel === "canary", "Invalid update channel")
      const old = await this.read()
      await this.write({ schemaVersion: 1, channel }); await this.removePayload(old.pending)
    })
  }
  clearPending() {
    return this.mutate(async () => {
      const state = await this.read()
      await this.write({ schemaVersion: 1, channel: state.channel }); await this.removePayload(state.pending)
    })
  }
  stage(local: UnixInstalledBuild, installation: UnixInstallation, update: VerifiedUnixUpdate, source: string) {
    return this.mutate(async () => {
      const channel = update.manifest.channel
      const manifest = verifySignedUnixUpdateManifest(update.manifestBytes, update.signatureBytes, this.keys, { ...this.target, channel } as UnixUpdateTarget)
      assert.equal(manifest.hash, update.manifest.hash, "Pending update hash differs from verified manifest")
      if (channel === local.channel) assert.ok(compareReleaseVersions(manifest.version, local.version) > 0, "Pending update must be newer")
      const artifact = selectUnixUpdateArtifact(installation, manifest)
      await verifyUnixUpdateFile(source, artifact)
      await this.privateDirectory(true)
      const payload = `payload-${randomBytes(16).toString("hex")}`, file = this.payloadPath(payload)
      let published = false
      try {
        await copyFile(source, file, constants.COPYFILE_EXCL)
        await verifyUnixUpdateFile(file, artifact)
        const handle = await open(file, "r+")
        try { await handle.sync() } finally { await handle.close() }
        const old = await this.read()
        await this.write({ schemaVersion: 1, channel, pending: { from: local, installation, manifest: update.manifestBytes.toString("base64"),
          signature: update.signatureBytes.toString("base64"), payload, deferred: false } })
        published = true
        await this.removePayload(old.pending)
      } catch (error) { if (!published) await rm(file, { force: true }); throw error }
    })
  }
  private async inspect(local: UnixInstalledBuild, installation: UnixInstallation): Promise<PendingUnixUpdate | null> {
    const state = await this.read(), saved = state.pending
    if (!saved) return null
    assert.ok(state.channel && saved.from && saved.installation && typeof saved.manifest === "string" && saved.manifest.length <= 90_000 &&
      typeof saved.signature === "string" && saved.signature.length <= 2048, "Invalid pending update metadata")
    const manifestBytes = Buffer.from(saved.manifest, "base64"), signatureBytes = Buffer.from(saved.signature, "base64")
    const manifest = verifySignedUnixUpdateManifest(manifestBytes, signatureBytes, this.keys, { ...this.target, channel: state.channel } as UnixUpdateTarget)
    assert.ok(saved.installation.kind === installation.kind && saved.installation.target === installation.target && saved.installation.platform === installation.platform, "Pending update belongs to a different installation")
    if (local.channel === manifest.channel && local.hash === manifest.hash && local.version === manifest.version) return null
    assert.ok(saved.from.hash === local.hash && saved.from.channel === local.channel && saved.from.version === local.version, "Pending update belongs to a different installed build")
    if (local.channel === manifest.channel) assert.ok(compareReleaseVersions(manifest.version, local.version) > 0, "Pending update must be newer")
    const file = this.payloadPath(saved.payload)
    await verifyUnixUpdateFile(file, selectUnixUpdateArtifact(installation, manifest))
    return { update: { manifest, manifestBytes, signatureBytes, baseUrl: expectedUpdateBaseUrl(manifest.channel, manifest.version) }, path: file, installation, deferred: saved.deferred === true }
  }
  async peek(local: UnixInstalledBuild, installation: UnixInstallation) { await this.queue; return this.inspect(local, installation) }
  defer(local: UnixInstalledBuild, installation: UnixInstallation) {
    return this.mutate(async () => {
      assert.ok(await this.inspect(local, installation), "No downloaded update to defer")
      const state = await this.read(); state.pending!.deferred = true; await this.write(state)
    })
  }
  consumeDeferred(local: UnixInstalledBuild, installation: UnixInstallation) {
    return this.mutate(async () => {
      assert.ok(await this.inspect(local, installation), "No downloaded update to resume")
      const state = await this.read(); state.pending!.deferred = false; await this.write(state)
    })
  }
}
