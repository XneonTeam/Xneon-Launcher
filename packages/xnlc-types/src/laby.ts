// ============================================================
// @xnlc/types — контракты каталога скинов Laby
// ============================================================
//
// Здесь только типы: они пересекают границу main ↔ renderer, поэтому лежат в
// пакете общих контрактов (`ipc-contracts.ts` ссылается на них).
//
// Вся работа с каталогом — адреса API, запросы, маппинг ответов, кэш, фильтры,
// пагинация и «похожие» скины — живёт в `@xnlc/skins` и в типах не нуждается.
// Раньше помощники были здесь; это смешивало контракты с реализацией и
// заставляло renderer тянуть логику сервера.

/** Режимы выдачи, которые реально поддерживает Laby (`order` в запросе). */
export type LabyOrder = "trending_24h" | "trending_7d" | "trending_30d" | "most_used" | "latest"

/** Скин в том виде, в котором его рисует UI лаунчера. */
export type LabySkin = {
  /** `image_hash` — он же стабильный ключ кэша и идентификатор избранного. */
  id: string
  hash: string
  /** Подпись: первый тег или «Skin #abcdef». У Laby имён у скинов нет. */
  name: string
  tags: string[]
  slim: boolean
  /** Сколько раз скин использовали — единственная метрика, что даёт API. */
  useCount: number
  /** PNG 64×64 (CORS разрешён — годится и для палитры, и для импорта). */
  textureUrl: string
  /** Готовый рендер 256×256 для карточки. */
  renderUrl: string
  source: "laby"
}

/** Скин из истории игрока. */
export type LabyPlayerSkin = {
  hash: string
  slim: boolean
  /** Сколько раз игрок носил этот скин. */
  useCount: number
  /** Скин надет прямо сейчас. */
  active: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export type LabyPlayer = {
  uuid: string
  username: string
  /** Голова игрока: рендерит сам Laby по UUID. */
  headUrl: string
  /** Текущая текстура скина игрока. */
  skinUrl: string
  /** История скинов, свежие сверху, активный — первым. */
  skins: LabyPlayerSkin[]
  /** Сколько плащей Laby видел на игроке. */
  capesCount: number
}

export type LabyTagPreview = {
  hash: string
  slim: boolean
}

export type LabyTag = {
  id: number
  /** Имя тега, как его отдаёт Laby (`Girl`). */
  name: string
  /** Локализованное имя из `translations`, если оно есть. */
  label: string
  useCount: number
  color: string | null
  /** Несколько скинов-примеров: больше трёх Laby не отдаёт. */
  preview: LabyTagPreview[]
}

/** Ошибка запроса в том виде, в котором её показывает UI. */
export type LabyApiError = {
  code: string
  message: string
  retryable: boolean
}

export type LabyCatalogPage = {
  items: LabySkin[]
  page: number
  size: number
  /** Сервер вернул полную страницу — значит есть следующая. */
  hasMore: boolean
  /**
   * Запрошенная страница уже за пределами выдачи.
   *
   * Laby не отдаёт общее количество, а на `offset` за концом списка отвечает
   * `403`, а не пустым массивом. Это не блокировка и не ошибка — так каталог
   * сообщает, что данные кончились, поэтому UI должен сказать «дальше нет», а
   * не показывать предупреждение о недоступности.
   */
  endOfFeed: boolean
  /** Данные из кэша: Laby не ответил, показываем последнее удачное. */
  stale: boolean
  /** Фильтр по тегу/тексту применён локально по загруженному пулу. */
  filteredLocally: boolean
  /**
   * Ошибка запроса. Возвращается полем, а не исключением: UI должен показать
   * состояние ошибки, а не получить необработанный reject.
   */
  error: LabyApiError | null
}

export type LabyImportResult = {
  saved: boolean
  librarySkinId: string | null
  applied: boolean
  error?: string
}