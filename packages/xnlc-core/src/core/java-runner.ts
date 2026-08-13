// ============================================================
// XNLC — Java Runner
// Launches Minecraft with the built command
// Author: MAINER4IK
// ============================================================

import { spawn } from "child_process";
import * as fs from "fs";
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

function resolveSpawnTarget(program: string, args: string[]): { cmd: string; args: string[] } {
  if (!isBatchFile(program)) {
    return { cmd: program, args };
  }
  const comspec = process.env.ComSpec ?? "cmd.exe";
  const inner = `"${program}"${args.map((a) => ` "${a.replace(/"/g, '""')}"`).join("")}`;
  return { cmd: comspec, args: ["/d", "/s", "/c", `"${inner}"`] };
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

    const target = resolveSpawnTarget(program, programArgs);
    const child = spawn(target.cmd, target.args, {
      cwd: options?.cwd ?? gameDir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
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
