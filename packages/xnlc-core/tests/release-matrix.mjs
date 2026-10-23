import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fork, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Длительный возобновляемый прогон. Пользовательский кэш используется только
// для чтения; все скачивания, профили и игровые файлы находятся внутри --root.
const script = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const root = path.resolve(option("--root", path.resolve(path.dirname(script), "../../../.tmp/launch-matrix")));
const source = path.resolve(option("--source", path.join(process.env.APPDATA || os.homedir(), "xneonlauncher/minecraft")));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
};
const keyOf = row => `${row.mcVersion}__${row.loaderType}`;
const cache = path.join(root, "cache");

async function acquire(file) {
  while (true) {
    try { fs.writeFileSync(file, String(process.pid), { flag: "wx" }); return; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      try { const owner = Number(fs.readFileSync(file, "utf8")); if (owner) process.kill(owner, 0); }
      catch (ownerError) { if (ownerError.code === "ESRCH") { fs.rmSync(file, { force: true }); continue; } }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

function release(file) {
  try { if (fs.readFileSync(file, "utf8") === String(process.pid)) fs.rmSync(file, { force: true }); } catch {}
}

async function syncInventory() {
  const sources = {
    mojang: "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    forge: "https://meta.prismlauncher.org/v1/net.minecraftforge/index.json",
    neoforge: "https://meta.prismlauncher.org/v1/net.neoforged/index.json",
    liteloader: "https://meta.prismlauncher.org/v1/com.mumfrey.liteloader/index.json",
    intermediary: "https://meta.prismlauncher.org/v1/net.fabricmc.intermediary/index.json",
    fabricLoader: "https://meta.prismlauncher.org/v1/net.fabricmc.fabric-loader/index.json",
    quiltLoader: "https://meta.prismlauncher.org/v1/org.quiltmc.quilt-loader/index.json",
    optifine: "https://optifine.net/downloads",
  };
  fs.mkdirSync(path.join(root, "input"), { recursive: true });
  await Promise.all(Object.entries(sources).map(async ([name, url]) => {
    const file = path.join(root, "input", `${name}.json`);
    if (fs.existsSync(file) && !args.includes("--refresh-inventory")) return;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Inventory ${name}: HTTP ${response.status}`);
    fs.writeFileSync(file, await response.text());
  }));
}

function buildMatrix() {
  const input = name => read(path.join(root, "input", `${name}.json`));
  const releases = input("mojang").versions.filter(version => version.type === "release").reverse();
  const indexes = Object.fromEntries(["forge", "neoforge", "liteloader"].map(name => [name, input(name)]));
  const intermediary = new Set(input("intermediary").versions.map(version => version.version));
  const fabric = input("fabricLoader").versions[0].version;
  const quiltVersions = input("quiltLoader").versions;
  const quilt = (quiltVersions.find(version => !/-beta|-pre|-rc/.test(version.version)) || quiltVersions[0]).version;
  const ofFiles = [...fs.readFileSync(path.join(root, "input/optifine.json"), "utf8").matchAll(/adloadx\?f=([^"&]+)/g)]
    .map(match => decodeURIComponent(match[1]));
  const rows = [];
  for (const release of releases) {
    const common = { mcVersion: release.id, metadataUrl: release.url };
    rows.push({ ...common, loaderType: "vanilla" });
    for (const [loaderType, index] of Object.entries(indexes)) {
      const versions = index.versions.filter(version => version.requires.some(req => req.uid === "net.minecraft" && req.equals === release.id));
      if (versions.length) rows.push({ ...common, loaderType, loaderVersion: (versions.find(version => version.recommended) || versions[0]).version });
    }
    if (intermediary.has(release.id)) {
      rows.push({ ...common, loaderType: "fabric", loaderVersion: fabric });
      rows.push({ ...common, loaderType: "quilt", loaderVersion: quilt });
    }
    const files = ofFiles.filter(file => file.match(/OptiFine_(\d+\.\d+(?:\.\d+)?)_/)?.[1] === release.id);
    const filename = files.find(file => !file.startsWith("preview_")) || files[0];
    if (filename) rows.push({ ...common, loaderType: "optifine", loaderVersion: filename });
  }
  write(path.join(root, "matrix.json"), { createdAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, releases: releases.length, rows });
  return rows;
}

function report(rows, results) {
  // Несколько выборочных повторных прогонов могут идти одновременно с полной
  // матрицей. Источник правды — отдельный result.json каждого кейса.
  const saved = rows.flatMap(row => { const file = path.join(root, "cases", keyOf(row), "result.json"); return fs.existsSync(file) ? [read(file)] : []; });
  results.splice(0, results.length, ...saved);
  const cells = new Map(results.map(result => [result.key, result]));
  const counts = {};
  for (const row of rows) { const status = cells.get(keyOf(row))?.status || "pending"; counts[status] = (counts[status] || 0) + 1; }
  write(path.join(root, "results.json"), { updatedAt: new Date().toISOString(), total: rows.length, counts, results });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const body = rows.map(row => { const result = cells.get(keyOf(row)); return `<tr class="${result?.status || "pending"}"><td>${escape(row.mcVersion)}</td><td>${escape(row.loaderType)}</td><td>${escape(row.loaderVersion)}</td><td>${escape(result?.status || "pending")}</td><td>${escape(result?.seconds)}</td><td title="${escape(result?.javaPath)}">${escape(result?.javaVersion)}</td><td>${escape(result?.error || result?.evidence?.join("; "))}</td><td><a href="cases/${keyOf(row)}/test.log">подготовка</a> · <a href="cases/${keyOf(row)}/game-output.log">JVM</a> · <a href="cases/${keyOf(row)}/result.json">JSON</a></td></tr>`; }).join("\n");
  fs.writeFileSync(path.join(root, "report.html"), `<!doctype html><meta charset="utf-8"><title>Матрица запуска Minecraft</title><style>body{font:14px system-ui;background:#141820;color:#ddd;padding:24px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #384050;text-align:left}a{color:#8cf}.pass{background:#153228}.failure,.prepare-failure{background:#421f27}.timeout{background:#433719}input{padding:10px;width:320px}td:nth-child(7){max-width:650px;overflow-wrap:anywhere}</style><h1>Стабильные Minecraft: ${rows.length} сочетаний</h1><p>${escape(JSON.stringify(counts))}</p><p>pass означает подтверждённую инициализацию клиента и выбранного загрузчика; тест завершает свою JVM принудительно после подтверждения. pending — ещё не проверено.</p><input placeholder="Фильтр по версии, загрузчику, статусу" oninput="for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())"><table><thead><tr><th>Minecraft</th><th>Загрузчик</th><th>Сборка</th><th>Статус</th><th>Сек.</th><th>Java</th><th>Подтверждение / ошибка</th><th>Лог</th></tr></thead><tbody>${body}</tbody></table>`);
  return counts;
}

function seedCache() {
  for (const directory of ["versions", "libraries", "assets", "runtime", "installers"]) fs.mkdirSync(path.join(cache, directory), { recursive: true });
  // Полные копии библиотек и ассетов создаются один раз, а не на каждый кейс.
  // Не используем жёсткие ссылки на пользовательские данные: модлоадеры могут
  // перезаписывать файлы во время своей подготовки.
  const marker = path.join(cache, ".seeded");
  if (!fs.existsSync(marker)) {
    for (const directory of ["libraries", "assets", "installers"]) {
      if (fs.existsSync(path.join(source, directory))) fs.cpSync(path.join(source, directory), path.join(cache, directory), { recursive: true, force: false, errorOnExist: false });
    }
    for (const entry of fs.readdirSync(path.join(source, "versions"), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+(?:\.\d+)*$/.test(entry.name)) continue;
      fs.cpSync(path.join(source, "versions", entry.name), path.join(cache, "versions", entry.name), { recursive: true, force: false });
    }
    fs.writeFileSync(marker, new Date().toISOString());
  }
}

async function worker() {
  const row = read(path.join(root, "matrix.json")).rows[Number(option("--worker", "0"))];
  const key = keyOf(row);
  const gameDir = path.join(root, "cases", key);
  fs.mkdirSync(gameDir, { recursive: true });
  const runLock = path.join(gameDir, "run.lock");
  await acquire(runLock);
  const previousResult = path.join(gameDir, "result.json");
  if (fs.existsSync(previousResult) && read(previousResult).status === "pass" && !args.includes("--rerun")) {
    process.send?.({ type: "done", result: read(previousResult) });
    release(runLock);
    setTimeout(() => process.exit(0), 30);
    return;
  }
  if (fs.existsSync(previousResult)) {
    const previous = read(previousResult);
    const attempt = path.join(gameDir, "attempts", previous.startedAt.replace(/[:.]/g, "-"));
    fs.mkdirSync(attempt, { recursive: true });
    fs.copyFileSync(previousResult, path.join(attempt, "result.json"));
    const output = path.join(gameDir, "game-output.log");
    if (fs.existsSync(output)) fs.copyFileSync(output, path.join(attempt, "game-output.log"));
  }
  process.env.XNLC_GAME_DIR = gameDir;
  process.env.XNLC_META_CACHE_DIR = path.join(root, "metadata");
  for (const directory of ["versions", "libraries", "assets", "runtime", "installers"]) {
    const destination = path.join(gameDir, directory);
    if (!fs.existsSync(destination)) fs.symlinkSync(path.join(cache, directory), destination, process.platform === "win32" ? "junction" : "dir");
  }
  if (fs.existsSync(path.join(source, "lib"))) fs.cpSync(path.join(source, "lib"), path.join(gameDir, "lib"), { recursive: true });
  const { Xnlc } = await import("../lib/xnlc.js");
  const startedAt = Date.now();
  let stage = "prepare", gameProcess, gameOutput = "", launchTimer, readyTimer, finished = false, selectedJava, selectedJavaVersion;
  const preparationLock = path.join(root, "prepare.lock");
  const finish = async (status, error, evidence = []) => {
    if (finished) return;
    finished = true;
    clearTimeout(launchTimer); clearTimeout(readyTimer);
    if (gameProcess && gameProcess.exitCode === null) {
      gameProcess.kill();
      await Promise.race([new Promise(resolve => gameProcess.once("close", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    const result = { key, ...row, status, stage, error, evidence, javaPath: selectedJava, javaVersion: selectedJavaVersion,
      extraJvmArgs: JSON.parse(process.env.XNLC_MATRIX_JVM_ARGS || "[]"),
      startedAt: new Date(startedAt).toISOString(), seconds: Math.round((Date.now() - startedAt) / 1000) };
    fs.writeFileSync(path.join(gameDir, "game-output.log"), gameOutput);
    write(path.join(gameDir, "result.json"), result);
    release(preparationLock); release(runLock);
    process.send?.({ type: "done", result });
    setTimeout(() => process.exit(status === "pass" ? 0 : 1), 30);
  };
  process.on("message", message => { if (message.type === "stop") void finish(stage === "prepare" ? "prepare-timeout" : "timeout", "Supervisor timeout"); });
  const core = new Xnlc({ gameDir });
  core.javaRunner.setPipeOutputToConsole(false);
  const realLaunch = core.javaRunner.launch.bind(core.javaRunner);
  core.javaRunner.launch = (...parameters) => {
    const result = realLaunch(...parameters);
    selectedJava = parameters[0][0];
    const versionProbe = spawnSync(selectedJava, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    selectedJavaVersion = `${versionProbe.stderr || ""}${versionProbe.stdout || ""}`.match(/version "([^"]+)"/)?.[1];
    gameProcess = result.process; stage = "java";
    release(preparationLock);
    process.send?.({ type: "jvm-started", key });
    const observe = data => {
      const text = new TextDecoder(process.platform === "win32" ? "cp866" : "utf-8").decode(data);
      gameOutput += text;
      const client = /OpenAL initialized|Sound engine started|Sound engine is now started|Created: .*textures|Narrator library.*loaded|Backend library:|LWJGL Version:/i.test(gameOutput);
      let loader = row.loaderType === "vanilla";
      if (row.loaderType === "forge") loader = /Mod Loaded:.*MinecraftForge|MinecraftForge.*Initialized|successfully loaded \d+ mods|Forge mod loading|Forge.*mod.*loading.*version/i.test(gameOutput);
      if (row.loaderType === "neoforge") loader = /NeoForge mod loading|NeoForge.*loading|Found mod file.*neoforge|ModLauncher.*neoforge/i.test(gameOutput);
      if (row.loaderType === "fabric") loader = /Loading Minecraft .*Fabric Loader|Fabric Loader .*loaded/i.test(gameOutput);
      if (row.loaderType === "quilt") loader = /Loading Minecraft .*Quilt Loader|Quilt Loader.*loading|Quilt Loader .*loaded/i.test(gameOutput);
      if (row.loaderType === "liteloader") loader = /LiteLoader.*initialis|LiteLoader.*initializ|LiteLoader.*starting|Loading LiteLoader/i.test(gameOutput);
      if (row.loaderType === "optifine") loader = /\[OptiFine\]|OptiFine HD|OptiFine_[A-Z]/i.test(gameOutput);
      if (client && loader && !readyTimer) {
        stage = "client-initialized";
        readyTimer = setTimeout(() => void finish("pass", undefined, gameOutput.split(/\r?\n/).filter(line => /OpenAL initialized|Sound engine started|LWJGL Version:|Backend library:|Loading Minecraft|Mod Loaded:|MinecraftForge.*Initialized|NeoForge mod loading|\[OptiFine\]|LiteLoader.*initial/i.test(line)).slice(-8)), 5000);
      }
    };
    gameProcess.stdout?.on("data", observe); gameProcess.stderr?.on("data", observe);
    gameProcess.once("error", error => void finish("failure", String(error)));
    gameProcess.once("close", code => { if (!finished) void finish("failure", `JVM exited before confirmation, code=${code}`, gameOutput.split(/\r?\n/).filter(line => /Exception|Error|Caused by|failed/i.test(line)).slice(-6)); });
    const javaDeadline = parameters[0].includes("io.github.zekerzhayard.forgewrapper.installer.Main") ? 300000 : 60000;
    launchTimer = setTimeout(() => void finish("timeout", `No confirmed client + loader initialization within ${javaDeadline / 1000} seconds`, gameOutput.split(/\r?\n/).filter(Boolean).slice(-5)), javaDeadline);
    return result;
  };
  try {
    await acquire(preparationLock);
    // Чтение локально скопированного базового JSON допускается, как при обычном
    // установленном клиенте; отсутствующие версии проходят штатную загрузку.
    const base = await core.metaClient.fetchVersionJson(row.mcVersion);
    const major = base.javaVersion?.majorVersion || 8;
    const modern = major > 8 || Number(row.mcVersion.split(".")[0]) > 1 || Number(row.mcVersion.split(".")[1]) >= 13;
    const choices = [
      major <= 8 && (process.env.XNLC_MATRIX_JAVA8 || path.join(source, "runtime/windows-x64/jre-legacy/bin/java.exe")),
      major > 8 && major <= 17 && process.env.XNLC_MATRIX_JAVA17,
      major > 8 && major <= 21 && path.join(source, "runtime/windows-x64/java-runtime-delta/bin/java.exe"),
      major > 21 && path.join(source, "runtime/windows-x64/java-runtime-epsilon/bin/java.exe"),
    ].filter(value => value && fs.existsSync(value));
    await core.launch(row, { mode: "offline", username: "XNLC_Matrix", uuid: "0123456789abcdef0123456789abcdef", accessToken: "0" },
      { javaPath: choices[0], memoryMin: "128M", memoryMax: modern ? "2G" : "1G", width: 640, height: 400,
        jvmArgs: JSON.parse(process.env.XNLC_MATRIX_JVM_ARGS || "[]") });
  } catch (error) { await finish(stage === "prepare" ? "prepare-failure" : "failure", String(error?.stack || error)); }
}

async function main() {
  fs.mkdirSync(root, { recursive: true });
  await syncInventory();
  const rows = args.includes("--rebuild-matrix") || !fs.existsSync(path.join(root, "matrix.json")) ? buildMatrix() : read(path.join(root, "matrix.json")).rows;
  if (args.includes("--inventory")) { console.log(JSON.stringify({ total: rows.length, releases: new Set(rows.map(row => row.mcVersion)).size })); return; }
  if (args.includes("--report-only")) { console.log(JSON.stringify(report(rows, []))); return; }
  seedCache();
  const results = rows.flatMap(row => { const file = path.join(root, "cases", keyOf(row), "result.json"); return fs.existsSync(file) ? [read(file)] : []; });
  const filter = option("--filter", "");
  const retry = args.includes("--retry-failed");
  const queue = rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    const previous = results.find(result => result.key === keyOf(row));
    return (!filter || keyOf(row).includes(filter)) && (!previous || (retry && previous.status !== "pass"));
  });
  const active = new Map(); let preparing = false;
  const concurrency = Number(option("--concurrency", "2"));
  const java = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin/java.exe");
  const java17 = process.env.XNLC_MATRIX_JAVA17 || (java && fs.existsSync(java) ? java : undefined);
  report(rows, results);
  await new Promise(resolve => {
    const schedule = () => {
      if (!queue.length && !active.size) { resolve(); return; }
      if (preparing || active.size >= concurrency || !queue.length) return;
      const { row, index } = queue.shift(); const key = keyOf(row);
      const directory = path.join(root, "cases", key); fs.mkdirSync(directory, { recursive: true });
      const log = fs.openSync(path.join(directory, "test.log"), "w");
      preparing = true;
      const child = fork(script, ["--root", root, "--source", source, "--worker", String(index)], { env: { ...process.env, XNLC_MATRIX_JAVA17: java17 || "" }, stdio: ["ignore", log, log, "ipc"], windowsHide: true });
      fs.closeSync(log);
      const entry = { child, preparing: true };
      active.set(key, entry);
      const timer = setTimeout(() => child.send({ type: "stop" }), 600000);
      let received = false;
      console.log(`START ${key} ${row.loaderVersion || ""}`);
      child.on("message", message => {
        if (message.type === "jvm-started") { entry.preparing = false; preparing = false; schedule(); }
        if (message.type === "done") {
          received = true;
          const existing = results.findIndex(result => result.key === key); if (existing >= 0) results.splice(existing, 1);
          results.push(message.result);
          console.log(`RESULT ${key} ${message.result.status} ${message.result.seconds}s ${(message.result.error || "").split("\n")[0]}`);
          report(rows, results);
        }
      });
      child.once("exit", code => {
        clearTimeout(timer); active.delete(key); if (entry.preparing) preparing = false;
        if (!received) {
          const result = { key, ...row, status: "worker-failure", error: `Worker exited with ${code}; see test.log` };
          results.push(result); write(path.join(directory, "result.json"), result); report(rows, results);
        }
        schedule();
      });
    };
    process.once("SIGINT", () => { queue.length = 0; for (const { child } of active.values()) child.send({ type: "stop" }); });
    schedule();
  });
  console.log("FINISHED", JSON.stringify(report(rows, results)));
}

if (args.includes("--worker")) await worker(); else await main();
