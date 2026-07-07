// ============================================================
// XNLC — Java Runner
// Launches Minecraft with the built command
// Author: MAINER4IK
// ============================================================

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { LaunchResult } from "../types/index.js";
import { getLogsDir } from "../utils/index.js";

export class JavaRunner {
  private currentProcess: import("child_process").ChildProcess | null = null;
  private pipeOutputToConsole = true;

  setPipeOutputToConsole(enabled: boolean): void {
    this.pipeOutputToConsole = enabled;
  }

  launch(fullCommand: string[], gameDir: string): LaunchResult {
    const javaPath = fullCommand[0];
    const allArgs = fullCommand.slice(1);

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
      ...process.env,
      APPDATA: process.env.APPDATA ?? gameDir,
    };

    if (platform === "linux") {
      env.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE ?? "x11";
      env.GLFW_PLATFORM = process.env.GLFW_PLATFORM ?? "x11";
    }

    const child = spawn(javaPath, allArgs, {
      cwd: gameDir,
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
