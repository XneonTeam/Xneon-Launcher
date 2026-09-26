// ============================================================
// @xnlc/skins — порты (внешние зависимости домена)
// ============================================================
//
// Пакет не знает ни про Electron, ни про SQLite, ни про файловую систему:
// всё, что выходит за пределы домена скинов, описано здесь интерфейсами, а
// реализации живут в лаунчере (`electron/main/skins/`).
//
// Такое разделение позволяет тестировать домен без Electron и переиспользовать
// пакет где угодно.

import type { LibrarySkin } from "@xnlc/types"

/**
 * Дисковый кэш.
 *
 * Нужен для офлайн-режима: когда Laby не отвечает, показываем последнее
 * удачное содержимое вместо пустого экрана. Имена файлов даёт пакет, раскладку
 * каталогов — реализация.
 */
export interface SkinDiskCache {
  read(name: string): Promise<Uint8Array | null>
  write(name: string, data: Uint8Array): Promise<void>
}

/** Что нужно домену от «Избранного», чтобы его хранить. */
export interface SkinLibraryStore {
  list(accountId: string): Promise<LibrarySkin[]>
  findById(id: string): Promise<LibrarySkin | null>
  findBySource(accountId: string, sourceId: string): Promise<LibrarySkin | null>
  /**
   * Заводит запись: файл текстуры и строку в базе. Одной операцией, потому что
   * запись без файла (и наоборот) — уже сломанное состояние.
   */
  create(input: {
    name: string
    variant: "classic" | "slim"
    accountId: string
    capeId: string | null
    sourceId: string | null
    data: Uint8Array
  }): Promise<LibrarySkin | null>
  /** Удаляет запись вместе с файлом текстуры. */
  remove(id: string): Promise<void>
  update(id: string, patch: { variant?: "classic" | "slim"; capeId?: string | null; name?: string }): Promise<void>
  /** Текстура записи: нужна, чтобы надеть скин или импортировать его заново. */
  readTexture(id: string): Promise<Uint8Array | null>
}

export type ResolvedSkinAccount = {
  id: string
  /** `microsoft` / `elyby` / `xnskins` — от этого зависит, какой API спрашивать. */
  type: string
  username?: string
  accessToken: string
  refreshToken?: string
}

/**
 * Аккаунт и его токен Minecraft Services.
 *
 * Токен Microsoft живёт ~24 часа, а у скинов он нужен и на чтение профиля, и на
 * надевание: без обновления по refresh-токену скин молча не надевался до
 * перезапуска лаунчера. Обновление — забота реализации порта, домен только
 * просит его.
 */
export interface SkinAccountPort {
  /**
   * Аккаунт с рабочим токеном или `null`, если аккаунта нет.
   *
   * Реализация обязана сама обновить протухший токен, если у аккаунта есть
   * refresh-токен, — иначе первый же запрос к Minecraft Services упадёт с 401.
   */
  resolve(accountId?: string): Promise<ResolvedSkinAccount | null>
  /**
   * Обновить токен после `401` и сохранить его.
   *
   * `null`, если обновление невозможно (офлайн-аккаунт, нет refresh-токена).
   */
  refresh(account: ResolvedSkinAccount): Promise<ResolvedSkinAccount | null>
}