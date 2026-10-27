// ============================================================
// XNLC — Java Runner
// Launches Minecraft with the built command
// Author: MAINER4IK
// ============================================================

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "node:url";
import { StringDecoder } from "node:string_decoder";
import AdmZip from "adm-zip/adm-zip.js";
import { LaunchResult } from "../types/index.js";
import { getLogsDir, cleanEnvForGame } from "../utils/index.js";

/**
 * Splits a command string into program + arguments, mirroring the
 * Commandline::splitArgs behavior of the reference launcher: whitespace
 * separates tokens, single/double quotes group tokens, backslash escapes
 * the next character inside quotes.
 */
function splitCommandLine(input: string): string[] {
  const argv: string[] = [];
  let current = "";
  let escape = false;
  let inQuotes: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (escape) {
      current += c;
      escape = false;
    } else if (inQuotes) {
      if (c === "\\") {
        escape = true;
      } else if (c === inQuotes) {
        inQuotes = null;
      } else {
        current += c;
      }
    } else {
      if (c === " ") {
        if (current.length > 0) {
          argv.push(current);
          current = "";
        }
      } else if (c === '"' || c === "'") {
        inQuotes = c;
      } else {
        current += c;
      }
    }
  }
  if (current.length > 0) argv.push(current);
  return argv;
}

function isBatchFile(program: string): boolean {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(program);
}

/** Пустые значения, пробелы, кавычки и # должны сохраняться в @argfile Java. */
function quoteArgForArgFile(arg: string): string {
  if (arg.length > 0 && !/[\s"'#]/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Лимит командной строки: Windows CreateProcess — 32767 символов, берём с запасом. */
export const WINDOWS_COMMAND_LIMIT = 30_000;
export const OTHER_PLATFORM_COMMAND_LIMIT = 120_000;

/**
 * Если команда длиннее лимита платформы, аргументы java выносятся во временный
 * `@argfile` (JVM читает его сама — так делают Forge и NeoForge). Возвращает
 * готовый список аргументов и путь к файлу, который нужно удалить после выхода
 * процесса. Вынесено из `launch` отдельной функцией, чтобы это можно было
 * проверить тестом без запуска java.
 */
export function writeJavaArgFileIfTooLong(
  javaArgs: string[],
  totalLength: number,
  limit: number,
  javaMajorVersion = 9,
): { args: string[]; cleanupPath: string | null } {
  if (javaArgs.length === 0 || totalLength <= limit) {
    return { args: javaArgs, cleanupPath: null };
  }
  // Java 8 не умеет читать @argfile. Короткий classpath-JAR с Manifest
  // сохраняет длинные пути, порядок библиотек и поддержку пробелов/кириллицы.
  if (javaMajorVersion < 9) {
    const cpIndex = javaArgs.findIndex(arg => arg === "-cp" || arg === "-classpath");
    if (cpIndex < 0 || !javaArgs[cpIndex + 1]) throw new Error("Java 8 command line is too long and has no classpath to compact");
    const classpath = javaArgs[cpIndex + 1];
    const urls = classpath.split(path.delimiter).map(file => {
      const url = pathToFileURL(path.resolve(file)).href;
      return fs.existsSync(file) && fs.statSync(file).isDirectory() ? `${url}/` : url;
    });
    const manifestLine = `Class-Path: ${urls.join(" ")}`;
    const lines: string[] = [];
    let remaining = manifestLine;
    while (remaining.length > 70) {
      lines.push(remaining.slice(0, 70));
      remaining = ` ${remaining.slice(70)}`;
    }
    lines.push(remaining);
    const file = path.join(os.tmpdir(), `xnlc-classpath-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jar`);
    const compacted = [...javaArgs];
    compacted[cpIndex + 1] = file;
    if (totalLength - classpath.length + file.length > limit) throw new Error("Java 8 command line is too long even with a compact classpath");
    const zip = new AdmZip();
    zip.addFile("META-INF/MANIFEST.MF", Buffer.from(`Manifest-Version: 1.0\r\n${lines.join("\r\n")}\r\n\r\n`, "utf8"));
    zip.writeZip(file);
    return { args: compacted, cleanupPath: file };
  }
  try {
    const argFile = path.join(os.tmpdir(), `xnlc-java-args-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(argFile, javaArgs.map(quoteArgForArgFile).join("\n"), "utf-8");
    return { args: [`@${argFile}`], cleanupPath: argFile };
  } catch (error) {
    // Не смогли записать файл — пробуем запустить как есть.
    console.warn(`[LaunchBuilder] Не удалось создать @argfile: ${error}`);
    return { args: javaArgs, cleanupPath: null };
  }
}

function resolveSpawnTarget(program: string, args: string[], javaMajorVersion = 9): { cmd: string; args: string[]; shell?: boolean; cleanupPath?: string } {
  if (!isBatchFile(program)) {
    return { cmd: program, args };
  }

  const inner = `"${program}"${args.map((a) => ` "${a.replace(/"/g, '""')}"`).join("")}`;

  // cmd.exe ограничен ~8191 символами и на командную строку, и на строку внутри
  // .cmd — обёртка с модовым classpath падала («Слишком длинная командная
  // строка» / «Слишком длинная входная строка»). Аргументы java укладываем в
  // @argfile: java @args.txt читает их сам (так же делают Forge и NeoForge).
  if (inner.length > 6000) {
    const [javaPath, ...javaArgs] = args;
    if (javaPath) {
      const prepared = writeJavaArgFileIfTooLong(javaArgs, inner.length, 6000, javaMajorVersion);
      return { cmd: program, args: [javaPath, ...prepared.args], shell: true, cleanupPath: prepared.cleanupPath ?? undefined };
    }
  }

  // shell: true — Node сам корректно соберёт вызов cmd.exe; ручные кавычки
  // давали двойное экранирование («""путь"" не является командой»).
  return { cmd: program, args, shell: true };
}

export class JavaRunner {
  private currentProcess: import("child_process").ChildProcess | null = null;
  private pipeOutputToConsole = true;

  setPipeOutputToConsole(enabled: boolean): void {
    this.pipeOutputToConsole = enabled;
  }

  launch(
    fullCommand: string[],
    gameDir: string,
    options?: {
      env?: Record<string, string>;
      wrapperCommand?: string;
      javaMajorVersion?: number;
      cwd?: string;
    },
  ): LaunchResult {
    const javaPath = fullCommand[0];
    const allArgs = fullCommand.slice(1);
    const wrapperCommand = options?.wrapperCommand?.trim();

    if (!javaPath) throw new Error("No Java path provided in launch command");

    // Validate javaPath exists
    if (!fs.existsSync(javaPath) && javaPath !== "java") {
      const javaDirs = process.env.PATH?.split(path.delimiter) ?? [];
      const found = javaDirs.some((dir) => fs.existsSync(path.join(dir, javaPath)));
      if (!found) {
        throw new Error(`Java not found at: ${javaPath}. Please install Java or specify --java-path`);
      }
    }

    // Ensure logs directory exists
    const logsDir = getLogsDir(gameDir);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Debug: print limited launch metadata to stderr without leaking secrets
    if (process.env.XNLC_DEBUG) {
      console.error("DEBUG Full Command:", fullCommand.join(" "));
    }

    // Log classpath length to diagnose Windows command-line length issues
    const cpIndex = allArgs.indexOf("-cp");
    if (cpIndex !== -1 && allArgs[cpIndex + 1]) {
      const cpLen = allArgs[cpIndex + 1].length;
      console.log(`[LaunchBuilder] Classpath length: ${cpLen} chars (limit ~8192 on Windows)`);
    }
    const totalLen = fullCommand.join(" ").length;
    console.log(`[LaunchBuilder] Total command length: ${totalLen} chars`);

    const platform = process.platform;
    const env: Record<string, string> = {
      ...cleanEnvForGame(process.env as Record<string, string>),
      ...(options?.env ?? {}),
      APPDATA: process.env.APPDATA ?? gameDir,
    };

    if (platform === "linux") {
      env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE ?? "x11";
      env.GLFW_PLATFORM = process.env.GLFW_PLATFORM ?? "x11";
    }

    // Wrapper command (e.g. optirun, flatpak run org.app) is prepended to the java invocation.
    const commandParts = wrapperCommand
      ? [...splitCommandLine(wrapperCommand), javaPath, ...allArgs]
      : [javaPath, ...allArgs];
    const program = commandParts[0];
    const programArgs = commandParts.slice(1);

    if (wrapperCommand && !fs.existsSync(program) && !program.includes("/") && !program.includes("\\")) {
      const onPath = (process.env.PATH ?? "").split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, program)));
      if (!onPath) {
        throw new Error(`Wrapper command not found: ${program}. Please check the wrapper path.`);
      }
    }

    /**
     * Прямой запуск java с модовым classpath может не влезть в лимит Windows
     * на командную строку (CreateProcess — 32767 символов; classpath на 300+
     * модов легко даёт больше). Классический путь — `java @argfile`: JVM читает
     * аргументы из файла сама, так же поступают Forge/NeoForge.
     *
     * Для обёрток (optirun, flatpak и т.п.) так делать нельзя — они парсят
     * аргументы сами; там длинную команду обрабатывает resolveSpawnTarget.
     */
    const commandLimit = process.platform === "win32" ? WINDOWS_COMMAND_LIMIT : OTHER_PLATFORM_COMMAND_LIMIT;
    let argFileCleanup: string | null = null;
    let spawnArgs = programArgs;
    if (!wrapperCommand) {
      const prepared = writeJavaArgFileIfTooLong(programArgs, commandParts.join(" ").length, commandLimit, options?.javaMajorVersion);
      spawnArgs = prepared.args;
      argFileCleanup = prepared.cleanupPath;
      if (argFileCleanup) {
        console.log(`[LaunchBuilder] Командная строка ${commandParts.join(" ").length} символов — подготовлен ${argFileCleanup.endsWith(".jar") ? "classpath-JAR" : "@argfile"}`);
      }
    }

    const target = resolveSpawnTarget(program, spawnArgs, options?.javaMajorVersion);
    const cleanupPath = target.cleanupPath ?? argFileCleanup;
    const child = spawn(target.cmd, target.args, {
      cwd: options?.cwd ?? gameDir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: target.shell === true,
    });
    this.currentProcess = child;
    const completion = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve(code ?? 1));
    });
    // Ошибка spawn может прийти до того, как вызывающая сторона вызовет wait().
    void completion.catch(() => {});

    // Log output
    // Minecraft/log4j сам пишет latest.log. Второй поток в тот же файл
    // перезаписывает его участки и повреждает диагностику запуска.
    const logFile = path.join(logsDir, "xnlc-launch.log");
    const logStream = fs.createWriteStream(logFile, { flags: "w" });

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    child.stdout?.on("data", (data: Buffer) => {
      const text = stdoutDecoder.write(data);
      if (this.pipeOutputToConsole) {
        process.stdout.write(text);
      }
      logStream.write(text);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = stderrDecoder.write(data);
      if (this.pipeOutputToConsole) {
        process.stderr.write(text);
      }
      logStream.write(text);
    });

    child.on("close", (code) => {
      this.currentProcess = null;
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (this.pipeOutputToConsole) {
        process.stdout.write(stdoutTail);
        process.stderr.write(stderrTail);
      }
      logStream.write(stdoutTail + stderrTail);
      logStream.end();
      // Временный @argfile / .cmd для длинной команды больше не нужен.
      if (cleanupPath) {
        try { fs.rmSync(cleanupPath, { force: true }); } catch { /* не критично */ }
      }
      if (code !== 0) {
        console.error(`Minecraft exited with code ${code}`);
      }
    });

    return {
      pid: child.pid ?? 0,
      process: child,
      wait: () => completion,
    };
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
