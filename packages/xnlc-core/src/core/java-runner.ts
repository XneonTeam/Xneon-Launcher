// ============================================================
// XNLC — Java Runner
// Launches Minecraft with the built command
// Author: MAINER4IK
// ============================================================

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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

/** Аргумент для @argfile Java: пробелы и кавычки требуют экранирования. */
function quoteArgForArgFile(arg: string): string {
  if (!/[\s"']/.test(arg)) return arg;
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
): { args: string[]; cleanupPath: string | null } {
  if (javaArgs.length === 0 || totalLength <= limit) {
    return { args: javaArgs, cleanupPath: null };
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

function resolveSpawnTarget(program: string, args: string[]): { cmd: string; args: string[]; shell?: boolean; cleanupPath?: string } {
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
      const argFile = path.join(os.tmpdir(), `xnlc-launch-${process.pid}-${Date.now()}.txt`);
      fs.writeFileSync(argFile, javaArgs.map(quoteArgForArgFile).join("\n"), "utf-8");
      return { cmd: program, args: [javaPath, `@${argFile}`], shell: true, cleanupPath: argFile };
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
      const prepared = writeJavaArgFileIfTooLong(programArgs, commandParts.join(" ").length, commandLimit);
      spawnArgs = prepared.args;
      argFileCleanup = prepared.cleanupPath;
      if (argFileCleanup) {
        console.log(`[LaunchBuilder] Командная строка ${commandParts.join(" ").length} символов — аргументы вынесены в @argfile`);
      }
    }

    const target = resolveSpawnTarget(program, spawnArgs);
    const cleanupPath = target.cleanupPath ?? argFileCleanup;
    const child = spawn(target.cmd, target.args, {
      cwd: options?.cwd ?? gameDir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: target.shell === true,
    });
    this.currentProcess = child;

    // Log output
    const logFile = path.join(logsDir, "latest.log");
    const logStream = fs.createWriteStream(logFile, { flags: "w" });

    const decode = (data: Buffer) =>
      process.platform === "win32" ? new TextDecoder("cp866").decode(data) : data.toString();

    child.stdout?.on("data", (data: Buffer) => {
      const text = decode(data);
      if (this.pipeOutputToConsole) {
        process.stdout.write(text);
      }
      logStream.write(text);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = decode(data);
      if (this.pipeOutputToConsole) {
        process.stderr.write(text);
      }
      logStream.write(text);
    });

    child.on("close", (code) => {
      this.currentProcess = null;
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
      wait: () => new Promise<number>((resolve) => {
        child.on("close", (code) => resolve(code ?? 0));
      }),
    };
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
