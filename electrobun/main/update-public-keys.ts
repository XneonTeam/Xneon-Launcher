// Public Ed25519 keys reviewed before publishing a signed update channel.
// Это единственный реестр доверия подписи: он попадает в собранный бандл, поэтому
// подпись проверяет установленная сборка, а не CI. Адреса каналов здесь не живут —
// их строит `repository-identity.ts` из репозитория текущей сборки.
export const updatePublicKeys: Readonly<Record<string, string>> = Object.freeze({
  // Прежний ключ: приватная часть недоступна, но оставлен, чтобы уже выпущенные
  // сборки могли проверять ранее подписанные манифесты.
  "ed25519-892052829307b55db09f6f02": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAOc0o+//R5yPiWZZLJvRO8TUrVaTIkh5G56D4r3czT0A=\n-----END PUBLIC KEY-----\n",
  // Ключ, которым подписаны ранее опубликованные манифесты 1.0.8 и который знают
  // установленные сборки 1.0.8. Оставлен, чтобы проверять уже выпущенные подписи.
  "ed25519-b0a245d9504c880c0b0e7792": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAKe/0B0n1ZGUVPCDjFwKmjCXR3GSAjK/wTuKeR1SI8D4=\n-----END PUBLIC KEY-----\n",
  // Действующий ключ подписи stable/canary. Сгенерирован после компрометации
  // предыдущего ключа 28ed; приватная часть хранится только в environment release-signing.
  "ed25519-437dba728abbaeaf511d0d1e": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAEV22gpLFFZI4qj2Wpx08/SqlcQJ2SmucQtX3ZrO40+g=\n-----END PUBLIC KEY-----\n",
})
