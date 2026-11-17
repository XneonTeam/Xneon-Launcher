import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { zipSync } from "fflate"
import { loadReactModule } from "../helpers/react-module.mjs"
import { appIdentifier } from "../../electrobun/main/app-identity.ts"

const root=path.resolve(import.meta.dir,"../..")
const read=file=>fs.readFile(path.join(root,file),"utf8")
const native=()=>import("../../scripts/electrobun-artifacts.ts")

test("Windows packaging выбирает системный bsdtar независимо от GNU tar в PATH", async t => {
  const { nativeTarExecutable } = await import("../../scripts/native-tar.ts")
  assert.equal(nativeTarExecutable("win32", { SystemRoot: "D:\\Windows" }), "D:\\Windows\\System32\\tar.exe")
  assert.equal(nativeTarExecutable("win32", { WINDIR: "C:\\Windows" }), "C:\\Windows\\System32\\tar.exe")
  assert.equal(nativeTarExecutable("linux", { SystemRoot: "D:\\Windows" }), "tar")
  assert.equal(nativeTarExecutable("darwin", {}), "tar")
  if (process.platform !== "win32") return
  await fs.mkdir(path.join(root, ".tmp"), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, ".tmp/native-tar-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, "marker.txt"), "native tar")
  const archive = path.join(directory, "fixture.zip")
  const executable = nativeTarExecutable()
  const packed = spawnSync(executable, ["-a", "-cf", archive, "-C", directory, "marker.txt"], { encoding: "utf8" })
  assert.equal(packed.status, 0, packed.stderr)
  const unpacked = spawnSync(executable, ["-xOf", archive, "marker.txt"], { encoding: "utf8" })
  assert.equal(unpacked.status, 0, unpacked.stderr)
  assert.equal(unpacked.stdout, "native tar")
})

test("NSIS сохранён отдельно от Electron metadata и unpacked ZIP",async()=>{
  const source=await read("scripts/build-windows-distribution.ts")
  assert.doesNotMatch(source,/release-metadata|writeBlockMap|writeLatestFile|latest\.yml|const unpacked/)
  assert.match(source,/installer\.nsi/)
  assert.match(source,/Bundled update manager is missing/)
  assert.match(source,/findMakensis/)
  const installer=await read("build/installer.nsi")
  for(const text of ["RequestExecutionLevel user","CreateManagedChannelJunction","ClearLegacyInstallRoot","WriteSchemeRegistry","WebView2","RunLauncherIfRequested"])assert.ok(installer.includes(text),text)
})

test("удалены только генераторы Electron-совместимой выдачи",async()=>{
  for(const file of ["scripts/release-metadata.ts","scripts/package-unix-candidate.sh","scripts/package-linux-targets.sh"])await assert.rejects(fs.access(path.join(root,file)),{code:"ENOENT"})
  for(const file of ["build/installer.nsi","scripts/build-windows-distribution.ts","scripts/package-windows-portable.ts"])await fs.access(path.join(root,file))
})

test("workflows больше не требуют Electron-артефактов, а quality gates сохранены",async()=>{
  for(const file of await fs.readdir(path.join(root,".github/workflows"))) {
    const source=await read(".github/workflows/"+file)
    assert.doesNotMatch(source,/release-metadata|package-unix-candidate|package-linux-targets|\.blockmap|latest(?:-mac|-linux)?\.yml/,file)
    const workflow=Bun.YAML.parse(source)
    for(const job of Object.values(workflow.jobs))if(job.uses?.startsWith("./"))await fs.access(path.join(root,job.uses))
    for(const match of source.matchAll(/\b(?:bun|bash|node)\s+(scripts\/[\w./-]+\.(?:[cm]?[jt]s|sh|ps1))/g))await fs.access(path.join(root,match[1]))
  }
  const ci=await read(".github/workflows/ci.yml")
  for(const command of ["bun run prepare:desktop","bun run typecheck","bun run test:offline:prepared","bun scripts/check-config.mjs"])assert.ok(ci.includes(command),command)
  const release=await read(".github/workflows/release.yml")
  for(const text of ["Ensure NSIS"])assert.ok(release.includes(text),text)
  const prerelease=await read(".github/workflows/pre-release.yml")
  for(const text of ["build:canary"])assert.ok(prerelease.includes(text),text)
  assert.doesNotMatch(prerelease,/Ensure NSIS/,'Пререлиз не ставит NSIS')
})

test("portable сохраняет отдельный профиль, но не копирует обычный unpacked/NSIS набор",async()=>{
  const source=await read("scripts/package-windows-portable.ts")
  for(const text of ["PortableProfile","portableAppIdentifier","validateBundleCredentials","windowsX64"])assert.ok(source.includes(text),text)
  assert.doesNotMatch(source,/\.blockmap|latest\.yml|unpackedSource|windowsInstaller|\[installer, destination\]/)
})

test("наборы файлов используют собственные имена Hutch, не aliases версий",async()=>{
  const {nativeArtifactNames}=await native()
  assert.deepEqual(nativeArtifactNames({platform:"win",arch:"x64",channel:"stable",version:"1.2.3",nsis:true}).sort(),[
    "stable-win-x64-update.json","stable-win-x64-update-v2.json","stable-win-x64-XneonLauncher.tar.zst","win-x64-XneonLauncher-Setup.zip","xneon-launcher-1.2.3-win-x64.exe",
  ].sort())
  for(const arch of ["arm64","x64"]) {
    const names=nativeArtifactNames({platform:"macos",arch,channel:"stable",version:"1.2.3"})
    assert.ok(names.includes(`macos-${arch}-XneonLauncher.dmg`))
    assert.ok(names.includes(`stable-macos-${arch}-XneonLauncher.app.tar.zst`))
    assert.ok(!names.includes(`stable-macos-${arch}-XneonLauncher.tar.zst`))
  }
  assert.ok(nativeArtifactNames({platform:"linux",arch:"x64",channel:"stable",version:"1.2.3"}).includes("linux-x64-XneonLauncher-Setup.tar.gz"))
  assert.ok(nativeArtifactNames({platform:"win",arch:"x64",channel:"canary",version:"1.2.3"}).includes("canary-win-x64-XneonLauncher-Setup-canary.zip"))
})

function pe(nsis=false) {
  const bytes=Buffer.alloc(160)
  bytes.write("MZ");bytes.writeUInt32LE(64,60);bytes.writeUInt32LE(0x4550,64);bytes.writeUInt16LE(0x8664,68)
  if(nsis)bytes.write("NullsoftInst",96)
  return bytes
}

function executable(platform,arch) {
  if(platform==="win")return pe()
  const bytes=Buffer.alloc(160)
  if(platform==="macos") {bytes.writeUInt32LE(0xfeedfacf);bytes.writeUInt32LE(arch==="arm64"?0x0100000c:0x01000007,4)}
  else {Buffer.from("7f454c46","hex").copy(bytes);bytes[4]=2;bytes[5]=1;bytes.writeUInt16LE(arch==="arm64"?183:62,18)}
  return bytes
}

async function fixture(t,platform="win",arch=platform==="macos"?"arm64":"x64") {
  await fs.mkdir(path.join(root,".tmp"),{recursive:true})
  const directory=await fs.mkdtemp(path.join(root,".tmp/packaging-"))
  t.after(()=>fs.rm(directory,{recursive:true,force:true}))
  // Штатный .app использует display name, в отличие от имени release-архива.
  const bundle=platform==="macos"?"Xneon Launcher.app":"XneonLauncher",prefix=`stable-${platform}-${arch}`
  const input=path.join(directory,"input"),tree=path.join(directory,"tree"),resources=path.join(tree,bundle,platform==="macos"?"Contents/Resources":"Resources")
  const bin=path.join(tree,bundle,platform==="macos"?"Contents/MacOS":"bin")
  await fs.mkdir(path.join(resources,"app/bun"),{recursive:true});await fs.mkdir(bin,{recursive:true});await fs.mkdir(input)
  const local={displayName:"Xneon Launcher",identifier:appIdentifier,channel:"stable",version:"1.2.3",hash:"fixture123",baseUrl:""}
  await fs.writeFile(path.join(resources,"version.json"),JSON.stringify(local))
  const creds=Array.from({length:12},(_,index)=>`p${index}: { clientId: "" }`).join(",\n")
  const mainSource=`var cloudCredentials = {\n${creds}\n};\n`
  await fs.writeFile(path.join(resources,"app/bun/index.js"),mainSource)
  for(const file of ["launcher","bun"])await fs.writeFile(path.join(bin,file+(platform==="win"?".exe":"")),executable(platform,arch))
  // Размеры fixture соблюдают прежние Windows sanity limits, без test-only bypass.
  if(platform==="win")await fs.writeFile(path.join(bin,"bun.exe"),Buffer.concat([pe(),randomBytes(1024**2+1024)]))
  await fs.writeFile(path.join(resources,"uninstall"),"native update manager")
  const tarFile=path.join(directory,"payload.tar")
  const packed=spawnSync(process.platform==="win32"?"tar.exe":"tar",["-cf",tarFile,"-C",tree,bundle],{encoding:"utf8"})
  assert.equal(packed.status,0,packed.stderr)
  const tar=await fs.readFile(tarFile),archive=Buffer.from(Bun.zstdCompressSync(tar))
  const manifest={schemaVersion:1,identifier:appIdentifier,version:local.version,channel:"stable",platform,arch,hash:local.hash,artifact:{file:`${prefix}-XneonLauncher${platform==="macos"?".app":""}.tar.zst`}}
  const v2={...manifest,artifact:{...manifest.artifact,tarSize:tar.length,tarSha256:createHash("sha256").update(tar).digest("hex")}}
  await fs.writeFile(path.join(input,manifest.artifact.file),archive)
  await fs.writeFile(path.join(input,prefix+"-update.json"),JSON.stringify(manifest))
  await fs.writeFile(path.join(input,prefix+"-update-v2.json"),JSON.stringify(v2))
  if(platform==="win")await fs.writeFile(path.join(input,"win-x64-XneonLauncher-Setup.zip"),zipSync({
    "Xneon Launcher-Setup.exe":pe(),".installer/Xneon Launcher-Setup.metadata.json":Buffer.from(JSON.stringify({name:"Xneon Launcher",identifier:appIdentifier,channel:"stable",hash:local.hash})),".installer/Xneon Launcher-Setup.tar.zst":archive,
  }))
  if(platform==="win")await fs.writeFile(path.join(input,"xneon-launcher-1.2.3-win-x64.exe"),Buffer.concat([pe(true),randomBytes(1024**2+1024)]))
  if(platform==="macos")await fs.writeFile(path.join(input,`macos-${arch}-XneonLauncher.dmg`),"fixture image: hdiutil verification runs on macOS CI")
  if(platform==="linux") {
    const setup=path.join(directory,"setup")
    await fs.mkdir(setup)
    const metadata={name:"Xneon Launcher",identifier:appIdentifier,channel:"stable",hash:local.hash}
    await fs.writeFile(path.join(setup,"installer"),Buffer.concat([executable(platform,arch),Buffer.from("ELECTROBUN_METADATA_V1"+JSON.stringify(metadata)+"ELECTROBUN_ARCHIVE_V1"),archive]))
    await fs.writeFile(path.join(setup,"README.txt"),"SDK installer fixture")
    const setupTar=path.join(directory,"setup.tar")
    const packed=spawnSync(process.platform==="win32"?"tar.exe":"tar",["-cf",setupTar,"-C",setup,"."],{encoding:"utf8"})
    assert.equal(packed.status,0,packed.stderr)
    await fs.writeFile(path.join(input,`linux-${arch}-XneonLauncher-Setup.tar.gz`),Bun.gzipSync(await fs.readFile(setupTar)))
  }
  return {directory,input,options:{platform,arch,channel:"stable",version:"1.2.3",nsis:platform==="win"},v2}
}

// Это I/O-интеграция с несколькими tar subprocess и >1 МиБ fixture, не сетевой timeout.
test("native release validation сохраняет все стандартные bytes и NSIS; checksums проверяются",{timeout:30_000},async t=>{
  const f=await fixture(t),{inspectElectrobunRelease,stageElectrobunRelease}=await native()
  const inspected=await inspectElectrobunRelease(f.input,f.options)
  assert.equal(inspected.files.length,5)
  const output=path.join(f.directory,"verified")
  await stageElectrobunRelease(f.input,output,f.options)
  assert.equal((await fs.readdir(output)).length,6)
  for(const file of inspected.files)assert.deepEqual(await fs.readFile(path.join(f.input,file)),await fs.readFile(path.join(output,file)))
  await inspectElectrobunRelease(output,{...f.options,requireChecksums:true})
  await fs.appendFile(path.join(output,"xneon-launcher-1.2.3-win-x64.exe"),"tamper")
  await assert.rejects(inspectElectrobunRelease(output,{...f.options,requireChecksums:true}),/checksum/i)
})

test("native validator отклоняет metadata Electron и неверную tar integrity",{timeout:30_000},async t=>{
  const f=await fixture(t),{inspectElectrobunRelease}=await native()
  const metadata=path.join(f.input,"latest.yml")
  await fs.writeFile(metadata,"version: 1.2.3")
  await assert.rejects(inspectElectrobunRelease(f.input,f.options),/Unexpected|artifact/i)
  await fs.rm(metadata)
  await fs.writeFile(path.join(f.input,"stable-win-x64-update-v2.json"),JSON.stringify({...f.v2,artifact:{...f.v2.artifact,tarSha256:"0".repeat(64)}}))
  await assert.rejects(inspectElectrobunRelease(f.input,f.options),/integrity|SHA|hash/i)
})

test("native validator не принимает path traversal и подмену identity/channel",{timeout:30_000},async t=>{
  const f=await fixture(t),{inspectElectrobunRelease}=await native()
  const file=path.join(f.input,"stable-win-x64-update-v2.json")
  for(const patch of [{artifact:{...f.v2.artifact,file:"../outside.tar.zst"}},{identifier:"untrusted.app"},{channel:"canary"}]) {
    await fs.writeFile(file,JSON.stringify({...f.v2,...patch}))
    await assert.rejects(inspectElectrobunRelease(f.input,f.options))
  }
})

test("native Unix metadata/header fixtures проходят без переименования; это не OS smoke",{timeout:30_000},async t=>{
  const {inspectElectrobunRelease}=await native()
  for(const platform of ["macos","linux"]) {
    const f=await fixture(t,platform)
    const checked=await inspectElectrobunRelease(f.input,f.options)
    assert.equal(checked.files.length,4)
    assert.ok(checked.files.some(name=>name.endsWith(platform==="macos"?".dmg":"-Setup.tar.gz")))
  }
})

test("executable validation отклоняет ошибочную архитектуру и короткие headers",async()=>{
  const {validateNativeExecutable,nativeArtifactNames}=await native()
  for(const platform of ["macos","linux"]) {
    validateNativeExecutable(executable(platform,"arm64"),platform,"arm64")
    validateNativeExecutable(executable(platform,"x64"),platform,"x64")
    assert.throws(()=>validateNativeExecutable(executable(platform,"arm64"),platform,"x64"))
    assert.throws(()=>validateNativeExecutable(Buffer.alloc(4),platform,"x64"))
  }
  assert.throws(()=>nativeArtifactNames({platform:"win",arch:"arm64",channel:"stable",nsis:true}))
  assert.throws(()=>nativeArtifactNames({platform:"win",arch:"x64",channel:"bad"}))
})

test("artifact checks сохраняют native delta patches и требуют hashes при promotion",{timeout:30_000},async t=>{
  const f=await fixture(t),{inspectElectrobunRelease}=await native()
  await assert.rejects(inspectElectrobunRelease(f.input,{...f.options,requireChecksums:true}),/checksums/)
  await fs.writeFile(path.join(f.input,"stable-win-x64-oldhash123.patch"),"native SDK delta")
  assert.equal((await inspectElectrobunRelease(f.input,f.options)).files.length,6)
  await fs.writeFile(path.join(f.input,"xneon-launcher-1.2.3-win-x64.exe"),Buffer.concat([pe(),randomBytes(1024**2+1024)]))
  await assert.rejects(inspectElectrobunRelease(f.input,f.options),/NSIS/)
})

test("wrapper не теряет exit status и запускает NSIS тем же Bun только после stable SDK build",()=>{
  for(const [channel,sdkStatus,nsisStatus,count,code]of [["stable",0,0,2,0],["stable",7,0,1,7],["stable",0,9,2,9],["canary",0,0,1,0],["dev",0,0,1,0]]) {
    const calls=[],process={argv:["pinned-bun.exe","electrobun.mjs","build","--env="+channel],execPath:"pinned-bun.exe",platform:"win32",env:{}}
    loadReactModule(new URL("../../scripts/electrobun.mjs",import.meta.url),{"node:child_process":{spawnSync:(...args)=>{calls.push(args);return{status:calls.length===1?sdkStatus:nsisStatus}}}},{process})
    assert.equal(calls.length,count)
    assert.equal(process.exitCode,code)
    if(count===2)assert.equal(calls[1][0],process.execPath)
    assert.equal(calls[0][2].env.XNEON_ARTIFACT_CHANNEL,channel)
  }
})

test("ресурс Windows identity содержит согласованные версии и завершается DWORD-границами", async () => {
  const { createWindowsVersionResource } = await import("../../scripts/windows-version-resource.ts")
  for (const version of ["1.2.3", "1.2.3-pre4"]) {
    const bytes = createWindowsVersionResource(version)
    const blocks = new Map()
    function block(start, limit) {
      const end = start + bytes.readUInt16LE(start)
      assert.ok(end > start && end <= limit)
      const length = bytes.readUInt16LE(start + 2), text = bytes.readUInt16LE(start + 4) === 1
      let cursor = start + 6
      while (bytes.readUInt16LE(cursor)) cursor += 2
      const key = bytes.toString("utf16le", start + 6, cursor)
      cursor = (cursor + 2 + 3) & ~3
      const valueEnd = cursor + length * (text ? 2 : 1)
      assert.ok(valueEnd <= end)
      blocks.set(key, bytes.subarray(cursor, valueEnd))
      cursor = (valueEnd + 3) & ~3
      while (cursor < end) { assert.equal(cursor % 4, 0); cursor = (block(cursor, end) + 3) & ~3 }
      return end
    }
    assert.equal(block(0, bytes.length), bytes.length)
    const fixed = blocks.get("VS_VERSION_INFO")
    assert.equal(fixed.length, 52)
    assert.equal(fixed.readUInt32LE(0), 0xfeef04bd)
    assert.equal(fixed.readUInt32LE(8), 0x00010002)
    assert.equal(fixed.readUInt32LE(12), 0x00030000)
    for (const key of ["FileDescription", "ProductName", "CompanyName"]) assert.equal(blocks.get(key).toString("utf16le"), "Xneon Launcher\0")
    assert.equal(blocks.get("ProductVersion").toString("utf16le"), version + "\0")
    assert.equal(blocks.get("FileVersion").toString("utf16le"), "1.2.3.0\0")
    assert.equal(blocks.get("OriginalFilename").toString("utf16le"), "Xneon Launcher.dll\0")
    assert.deepEqual([...blocks.get("Translation")], [9, 4, 176, 4])
  }
  assert.doesNotThrow(() => createWindowsVersionResource("1.2.3-beta1"))
  for (const value of ["", "1.2", "1.2.3\0bad", "1.2.3-rc1", "65536.0.0"]) assert.throws(() => createWindowsVersionResource(value))
})

test("Bun обновляет реальные PE metadata, сохраняет иконки и отклоняет непригодный файл", { skip: process.platform !== "win32" }, async t => {
  const { setWindowsExecutableVersion } = await import("../../scripts/windows-version-resource.ts")
  const { windowsProductIdentity } = await import("../../scripts/windows-candidate-validation.ts")
  const directory = await fs.mkdtemp(path.join(root, ".hutch/pe-identity-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, "Лаунчер с пробелами.exe")
  await fs.copyFile(process.execPath, file)
  // Независимый снимок всех ресурсов, кроме изменяемого RT_VERSION.
  function resources(bytes) {
    const pe = bytes.readUInt32LE(60), optional = pe + 24
    const sections = optional + bytes.readUInt16LE(pe + 20)
    const directoryOffset = bytes.readUInt16LE(optional) === 0x20b ? 112 : 96
    function offset(rva) {
      for (let index = 0; index < bytes.readUInt16LE(pe + 6); index++) {
        const section = sections + index * 40, base = bytes.readUInt32LE(section + 12)
        if (rva >= base && rva < base + bytes.readUInt32LE(section + 16)) return bytes.readUInt32LE(section + 20) + rva - base
      }
      throw new Error("Resource RVA is outside the PE sections")
    }
    const base = offset(bytes.readUInt32LE(optional + directoryOffset + 16)), result = {}
    function walk(relative, keys = []) {
      const directory = base + relative
      const count = bytes.readUInt16LE(directory + 12) + bytes.readUInt16LE(directory + 14)
      for (let index = 0; index < count; index++) {
        const entry = directory + 16 + index * 8, id = bytes.readUInt32LE(entry)
        if (!keys.length && id === 16) continue
        const target = bytes.readUInt32LE(entry + 4), key = [...keys, id]
        if (target & 0x80000000) walk(target & 0x7fffffff, key)
        else {
          const data = base + target, start = offset(bytes.readUInt32LE(data))
          result[key.join("/")] = createHash("sha256").update(bytes.subarray(start, start + bytes.readUInt32LE(data + 4))).digest("hex")
        }
      }
    }
    walk(0)
    return result
  }
  const originalResources = resources(await fs.readFile(file))
  assert.ok(Object.keys(originalResources).some(key => key.startsWith("3/")), "Fixture must contain icons")
  for (const version of ["1.2.3", "1.2.4-pre2"]) {
    await setWindowsExecutableVersion(file, version)
    windowsProductIdentity(file, version)
    assert.deepEqual(resources(await fs.readFile(file)), originalResources)
  }
  const executed = spawnSync(file, ["--version"], { encoding: "utf8" })
  assert.equal(executed.status, 0, executed.stderr)
  assert.equal(executed.stdout.trim(), Bun.version)
  const invalid = path.join(directory, "invalid.exe")
  await fs.writeFile(invalid, "not a PE")
  await assert.rejects(setWindowsExecutableVersion(invalid, "1.2.3"))
  assert.equal(await fs.readFile(invalid, "utf8"), "not a PE")
  await assert.rejects(setWindowsExecutableVersion(path.join(directory, "missing.exe"), "1.2.3"))
})
