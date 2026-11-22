import { runUnixUpdateHelper } from "./unix-update-helper"

// Отдельный entry нужен для CJS bundling: у него нет import.meta.main и подобных проверок.
void runUnixUpdateHelper(Bun.argv[2]).catch(error => {
  console.error("[Unix updater]", error instanceof Error ? error.message : "update-failed")
  process.exitCode = 1
})