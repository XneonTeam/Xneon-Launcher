import { app } from "electron"
import { initDatabaseCore, flushDatabasePersistence, flushDatabasePersistenceSync, isDbFallbackMode, getLauncherDirectory } from "./core"
import { initializeSchema } from "./migrations"
import { ensureInMemorySettingsDefaults } from "./settings"
import { loadAccounts, saveAccount, removeAccount, reorderAccounts, type DbAccount } from "./accounts"
import { loadBuilds, loadBuildsLight, loadBuildContent, saveAllBuilds, updateBuildPlaytime, updateBuildFields, type BuildJson } from "./builds"
import { getSetting, setSetting } from "./settings"
import { getCloudConfig, setCloudConfig, removeCloudConfig } from "./cloud"
import { getResources, upsertResource, setResourceCurseforge, markResourcesCurseforgeChecked, type ResourceRow } from "./resources"
import { getFileSnapshots, upsertFileSnapshot, type FileSnapshotRow } from "./snapshots"
import { loadSkinLibrary, saveSkinToLibrary, deleteSkinFromLibrary, updateSkinVariant, updateSkinCapeId, updateSkinName, type SkinLibraryRow } from "./skins"
import { aiListSessions, aiCreateSession, aiRenameSession, aiDeleteSession, aiListMessages, aiAddMessage } from "./ai"
import { listMcServers, listTrashedMcServers, getMcServer, createMcServer, updateMcServer, softDeleteMcServer, restoreMcServer, purgeTrashedMcServers, deleteMcServer, type McServerRow } from "./mc-servers"
import { addGameSession, listGameSessions, deleteGameSessionsForBuild, deleteGameSessionsForBuildNames, addServerSession, listServerSessions, type GameSessionRow, type ServerSessionRow } from "./stats"

export type { DbAccount, BuildJson, ResourceRow, FileSnapshotRow, SkinLibraryRow, McServerRow, GameSessionRow, ServerSessionRow }

export function isUsingFallbackStorage(): boolean {
  return isDbFallbackMode()
}

export async function initDatabase(): Promise<void> {
  ensureInMemorySettingsDefaults()
  await initDatabaseCore()
  initializeSchema()
}

export const dbHelpers = {
  loadAccounts,
  saveAccount,
  removeAccount,
  reorderAccounts,
  loadBuilds,
  loadBuildsLight,
  loadBuildContent,
  saveAllBuilds,
  updateBuildPlaytime,
  updateBuildFields,
  getLauncherDirectory,
  getSetting,
  setSetting,
  getCloudConfig,
  setCloudConfig,
  removeCloudConfig,
  getResources,
  upsertResource,
  setResourceCurseforge,
  markResourcesCurseforgeChecked,
  getFileSnapshots,
  upsertFileSnapshot,
  loadSkinLibrary,
  saveSkinToLibrary,
  deleteSkinFromLibrary,
  updateSkinVariant,
  updateSkinCapeId,
  updateSkinName,
  aiListSessions,
  aiCreateSession,
  aiRenameSession,
  aiDeleteSession,
  aiListMessages,
  aiAddMessage,
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
  deleteGameSessionsForBuild,
  deleteGameSessionsForBuildNames,
  addServerSession,
  listServerSessions,
}

process.once("beforeExit", flushDatabasePersistence)
process.once("exit", flushDatabasePersistenceSync)
app.on("will-quit", () => {
  flushDatabasePersistenceSync()
})
