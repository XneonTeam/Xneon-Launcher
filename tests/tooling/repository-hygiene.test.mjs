import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
const root=path.resolve(import.meta.dir,"../..")

test("research остаётся локальным, текущие benchmarks и public parser docs включены",async()=>{
  const ignore=await fs.readFile(path.join(root,".gitignore"),"utf8")
  assert.match(ignore,/^\/\.local-research\/$/m)
  const pkg=JSON.parse(await fs.readFile(path.join(root,"package.json"),"utf8"))
  assert.equal(pkg.scripts["benchmark:scan"],"bun benchmarks/scan-worker.ts")
  assert.equal(pkg.scripts["benchmark:archives"],"bun benchmarks/archives.ts")
  const parser=JSON.parse(await fs.readFile(path.join(root,"packages/xnlc-parser/package.json"),"utf8"))
  for(const file of ["README.md","INTEGRATION_GUIDE.md","SUPPORTED_FORMATS.md","LIMITATIONS.md","SECURITY.md","LICENSE","LICENSES.md","CHANGELOG.md"])assert.ok(parser.files.includes(file),file)
  for(const file of ["AUDIT.md","BENCHMARK.md","IMPLEMENTATION_PROGRESS.md","PRODUCTION_READINESS.md"])assert.ok(!parser.files.includes(file),file)
  for(const file of ["benchmarks/scan-worker.ts","benchmarks/archives.ts","benchmarks/README.md","docs/platform-builds.md"])await fs.access(path.join(root,file))
})

test("нет действующих импортов удалённых parser comparison/старых benchmark harness",async()=>{
  const result=spawnSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{cwd:root,encoding:"utf8",maxBuffer:16*1024**2})
  assert.equal(result.status,0,result.stderr)
  const forbidden=["packages/xnlc-parser/benchmarks/","scripts/benchmark-content-cache.ts","scripts/benchmark-modpack-persistence.ts","scripts/benchmark-server-copy.ts","scripts/benchmark-share.mjs"]
  for(const file of new Set(result.stdout.split("\0"))) {
    if(!/\.(?:ts|tsx|mjs|yml|json)$/.test(file)||file.startsWith("tests/tooling/repository-hygiene"))continue
    let text
    try{text=await fs.readFile(path.join(root,file),"utf8")}catch(error){if(error.code==="ENOENT")continue;throw error}
    for(const token of forbidden)assert.ok(!text.includes(token),file+": "+token)
  }
})
