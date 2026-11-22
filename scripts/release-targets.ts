import type { UpdateArch, UpdatePlatform } from "../electrobun/main/update-manifest"

/**
 * Платформы, которые реально публикуются в обоих каналах.
 *
 * Список — единственный источник истины для release/pre-release: по нему строятся
 * nativeSets в `ci-pipeline.ts`, allowlist публикации, подключение подписи и
 * проверка собранных артефактов. Матрицы `.github/workflows` обязаны совпадать.
 */
export type ReleaseTarget = { platform: UpdatePlatform; arch: UpdateArch }

export const releaseTargets: readonly ReleaseTarget[] = [
  { platform: "win", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "macos", arch: "arm64" },
]