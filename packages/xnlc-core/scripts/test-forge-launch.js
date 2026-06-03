import { Xnlc, createLaunchAuth } from "../lib/index.js";
import path from "path";
import os from "os";

async function testForgeLaunch() {
  const originalGameDir = path.join(os.homedir(), "AppData", "Roaming", "xneonlauncher", "minecraft");
  const gameDir = path.join(os.homedir(), "AppData", "Roaming", "xneonlauncher", "minecraft-test");
  console.log(`[TEST] Starting Forge 1.5.2 launch test...`);
  console.log(`[TEST] Game directory: ${gameDir}`);

  const xnlc = new Xnlc({
    gameDir: gameDir,
    launcherName: "XNLC-Test",
    launcherVersion: "1.0.0",
  });

  const selection = {
    mcVersion: "1.5.2",
    loaderType: "forge",
    loaderVersion: "7.8.1.738", // Latest version for 1.5.2 from loader meta
  };

  const auth = createLaunchAuth({
    type: "offline",
    username: "TestPlayer",
  });

  const config = {
    memoryMin: "512M",
    memoryMax: "2G",
  };

  try {
    console.log(`[TEST] Calling launch...`);
    const result = await xnlc.launch(selection, auth, config, (progress) => {
      if (progress.installationPhase) {
        console.log(`[TEST] Progress: ${progress.installationPhase} - ${progress.percent}% ${progress.fileName || ""}`);
      }
    });

    if (result && result.command) {
      console.log(`[TEST] Command line: ${result.command}`);
    }

    if (result && result.process) {
      console.log(`[TEST] Minecraft process started! PID: ${result.process.pid}`);
      
      let forgeFound = false;
      
      result.process.stdout?.on("data", (data) => {
        const output = data.toString();
        process.stdout.write(`[MC-STDOUT] ${output}`);
        
        // Проверка на наличие Forge в логах
        if (output.includes("Minecraft Forge") || output.includes("Forge Mod Loader")) {
          if (!forgeFound) {
            console.log(`\n[TEST SUCCESS] Forge detected in Minecraft logs!`);
            forgeFound = true;
            console.log(`[TEST] Stopping test as requested...`);
            result.process?.kill();
            process.exit(0);
          }
        }
      });

      result.process.stderr?.on("data", (data) => {
        const output = data.toString();
        process.stderr.write(`[MC-STDERR] ${output}`);
      });

      result.process.on("close", (code) => {
        console.log(`[TEST] Minecraft process closed with code ${code}`);
        if (!forgeFound) {
          console.error(`[TEST FAILED] Minecraft closed but Forge was not detected.`);
          process.exit(1);
        }
      });

      // Таймаут на случай, если майн запустился, но не логнул фордж (хотя должен)
      setTimeout(() => {
        if (!forgeFound) {
          console.log(`[TEST] Timeout reached. Stopping process.`);
          result.process?.kill();
          process.exit(1);
        }
      }, 60000);

    } else {
      console.error(`[TEST FAILED] Launch result did not contain a process.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`[TEST ERROR] ${error.stack || error}`);
    process.exit(1);
  }
}

testForgeLaunch();
