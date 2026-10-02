import { app } from "electron"
import { initDatabaseCore, flushDatabase, flushDatabaseSync, closeDatabase, isDbFallbackMode, getLauncherDirectory } from "./core"
import { initializeSchema } from "./migrations"
import { ensureInMemorySettingsDefaults } from "./settings"
import { loadAccounts, saveAccount, removeAccount, reorderAccounts, type DbAccount } from "./accounts"
import { loadBuilds, loadBuildsLight, loadBuildContent, saveAllBuilds, insertBuild, updateBuildPlaytime, updateBuildFields, deleteBuild, findBuildByName, findBuildById, type BuildJson, type BuildLightJson } from "./builds"
import { getSetting, setSetting } from "./settings"
import { getCloudConfig, setCloudConfig, removeCloudConfig } from "./cloud"
import { getResources, upsertResource, upsertResources, setResourceCurseforge, setResourcesCurseforge, markResourcesCurseforgeChecked, type ResourceRow } from "./resources"
import { getFileSnapshots, upsertFileSnapshot, upsertFileSnapshots, type FileSnapshotRow } from "./snapshots"
import { loadSkinLibrary, saveSkinToLibrary, deleteSkinFromLibrary, updateSkinVariant, updateSkinCapeId, updateSkinName, findLibrarySkinBySource, findLibrarySkinById, type SkinLibraryRow } from "./skins"
import { listMcServers, listTrashedMcServers, getMcServer, createMcServer, updateMcServer, softDeleteMcServer, restoreMcServer, purgeTrashedMcServers, deleteMcServer, type McServerRow } from "./mc-servers"
import { addGameSession, listGameSessions, listGameSessionsInRange, deleteGameSessionsForDeletedBuild, deleteOrphanGameSessions, addServerSession, listServerSessions, listServerSessionsInRange, deleteServerSessionsForDeletedServer, deleteOrphanServerSessions, type GameSessionRow, type ServerSessionRow } from "./stats"

export type { DbAccount, BuildJson, BuildLightJson, ResourceRow, FileSnapshotRow, SkinLibraryRow, McServerRow, GameSessionRow, ServerSessionRow }

export function isUsingFallbackStorage(): boolean {
  return isDbFallbackMode()
}

export async function initDatabase(): Promise<void> {
  ensureInMemorySettingsDefaults()
  await initDatabaseCore()
  initializeSchema()
  // Уборка осиротевшей статистики сборок живёт в main (`cleanupOrphanGameSessions`):
  // ей нужен каталог инстансов и снапшоты корзины, а настройка `instancesPath`
  // читается из уже инициализированной БД.
  // То же для серверов: у `server_sessions` нет FK с каскадом, поэтому удаления
  // до появления очистки оставили сирот.
  try {
    const removedServerSessions = await deleteOrphanServerSessions()
    if (removedServerSessions > 0) console.log(`[DB] Очищено записей статистики удалённых серверов: ${removedServerSessions}`)
  } catch (error) {
    console.error("[DB] Не удалось очистить статистику удалённых серверов:", error)
  }
}

export const dbHelpers = {
  loadAccounts,
  saveAccount,
  removeAccount,
  reorderAccounts,
  loadBuilds,
  loadBuildsLight,
  loadBuildContent,
  findBuildByName,
  findBuildById,
  saveAllBuilds,
  insertBuild,
  updateBuildPlaytime,
  updateBuildFields,
  deleteBuild,
  getLauncherDirectory,
  getSetting,
  setSetting,
  getCloudConfig,
  setCloudConfig,
  removeCloudConfig,
  getResources,
  upsertResource,
  upsertResources,
  setResourceCurseforge,
  setResourcesCurseforge,
  markResourcesCurseforgeChecked,
  getFileSnapshots,
  upsertFileSnapshot,
  upsertFileSnapshots,
  loadSkinLibrary,
  saveSkinToLibrary,
  deleteSkinFromLibrary,
  updateSkinVariant,
  updateSkinCapeId,
  updateSkinName,
  findLibrarySkinBySource,
  findLibrarySkinById,
  listMcServers,
  listTrashedMcServers,
  getMcServer,
  createMcServer,
  updateMcServer,
  softDeleteMcServer,
  restoreMcServer,
  purgeTrashedMcServers,
  deleteMcServer,
  addGameSession,
  listGameSessions,
  listGameSessionsInRange,
  deleteGameSessionsForDeletedBuild,
  deleteOrphanGameSessions,
  deleteServerSessionsForDeletedServer,
  deleteOrphanServerSessions,
  addServerSession,
  listServerSessions,
  listServerSessionsInRange,
}

process.once("beforeExit", flushDatabase)
process.once("exit", flushDatabaseSync)
app.on("will-quit", () => {
  // Чекпойнт WAL в основной файл и закрытие соединения — данные на диске
  // в согласованном виде даже без graceful shutdown.
  flushDatabaseSync()
  closeDatabase()
})
