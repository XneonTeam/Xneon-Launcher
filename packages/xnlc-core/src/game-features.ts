/** Quick Play появился в Java Edition 23w14a (релиз 1.20). */
export function supportsQuickPlay(version?: string | null): boolean {
  if (!version) return false
  const id = version.trim()
  const snapshot = /^(\d{2})w(\d{2})[a-z]$/i.exec(id)
  if (snapshot) {
    const year = Number(snapshot[1])
    return year > 23 || (year === 23 && Number(snapshot[2]) >= 14)
  }
  // Поддерживаем релизы, pre-release и release candidate, включая новую
  // нумерацию 26.x. Неизвестные и первоапрельские версии не угадываем.
  const release = /^(\d+)\.(\d+)(?:\.\d+)?(?:(?:-pre|-rc)\d+|\s+(?:Pre-Release|Release Candidate)\s+\d+|-snapshot-\d+)?$/i.exec(id)
  if (!release) return false
  return Number(release[1]) > 1 || (Number(release[1]) === 1 && Number(release[2]) >= 20)
}

/** Старым клиентам не передаём неизвестные им параметры --quickPlay*. */
export function getQuickPlayArguments(version: string, options: {
  path: string
  singleplayer?: string
  multiplayer?: string
}): string[] {
  if (!supportsQuickPlay(version)) return []
  const args = ["--quickPlayPath", options.path]
  if (options.singleplayer) args.push("--quickPlaySingleplayer", options.singleplayer)
  else if (options.multiplayer) args.push("--quickPlayMultiplayer", options.multiplayer)
  return args
}
