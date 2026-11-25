import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { renderRepositoryIdentityModule, resolveRepositoryIdentity } from "./repository-identity"

const root = path.resolve(import.meta.dir, "..")
// Файл лежит в `lib/`, потому что чистые данные идентичности нужны и main, и
// renderer (ссылки About/contributors). Правила остаются в `repository-identity.ts`.
const output = path.join(root, "lib", "repository-identity.generated.ts")
const repository = resolveRepositoryIdentity()

mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, renderRepositoryIdentityModule(repository))
console.log(`[gen-repository-identity] ${repository}`)
