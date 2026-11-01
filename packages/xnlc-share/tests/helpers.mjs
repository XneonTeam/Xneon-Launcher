import { createHash } from 'node:crypto'
export const hash = { digest: async (bytes, algorithm = 'SHA-256') => createHash(algorithm.replace('-', '').toLowerCase()).update(bytes).digest('hex') }
export const text = s => new TextEncoder().encode(s)
export const metadata = { name: 'Test', description: '', gameVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.0' }
export class MemoryFiles {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries).map(([p, b]) => [p, typeof b === 'string' ? text(b) : b])); this.reads = 0; this.hashes = 0 }
  async list() { return [...this.data].map(([path, b]) => ({ path, size: b.length, fingerprint: createHash('sha256').update(b).digest('hex') })) }
  async read(path) { this.reads++; const b = this.data.get(path); if (!b) throw new Error('ENOENT'); return b }
  async hash(path) { this.hashes++; const b = this.data.get(path); if (!b) throw new Error('ENOENT'); return { sha256: await hash.digest(b), sha512: await hash.digest(b, 'SHA-512') } }
  async apply(changes) {
    for (const c of changes) if ((this.data.has(c.path) ? await hash.digest(this.data.get(c.path)) : null) !== c.expected) throw new Error('LOCAL_CHANGED')
    for (const c of changes) c.bytes === null ? this.data.delete(c.path) : this.data.set(c.path, c.bytes)
  }
}
export async function external(path, contents) { const bytes = typeof contents === 'string' ? text(contents) : contents; const sha256 = await hash.digest(bytes); return { path, kind: 'config', sha256, size: bytes.length, enabled: true, object: sha256 } }
export function manifest(entries = [], instance = metadata) { return { schemaVersion: 1, instance, entries, exclusions: [] } }
