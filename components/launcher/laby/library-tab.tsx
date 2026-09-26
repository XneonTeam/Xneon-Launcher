import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAccounts } from "@/src/AccountsContext"
import { useActivityCenter } from "@/src/ActivityCenterContext"
import { LabyPanel } from "./laby-panel"
import { CatalogCard } from "./catalog-card"
import { CatalogToolbar } from "./catalog-toolbar"
import { PlayerHeader } from "./player-header"
import { Spinner } from "@/components/launcher/instance/spinner"
import { EMPTY_FILTERS, countActiveFilters, type CatalogFilters } from "./catalog-filters-dialog"
import { LABY_DEFAULT_ORDER, labyHashFromSourceId, labyPlayerSkinToSkin } from "@xnlc/skins"
import type { LabyOrder, LabyPlayer, LabySkin, LabyTag } from "@xnlc/types"
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconLayoutGrid, IconRefresh, IconUsers } from "@tabler/icons-react"

/**
 * Плотность сетки считается по ширине КОНТЕЙНЕРА, а не окна: сетка живёт в
 * правой колонке, поэтому оконные пороги не срабатывали.
 */
const GRID_CLASS =
  "grid w-full grid-cols-2 gap-2.5 @[400px]:grid-cols-3 @[620px]:grid-cols-4 @[820px]:grid-cols-5 @[1040px]:grid-cols-6"

/** Пауза перед локальным поиском: пользователь ещё печатает. */
const SEARCH_DEBOUNCE_MS = 400

const PAGE_SIZE = 25

function SectionHeader({
  icon,
  title,
  hint,
  count,
  trailing,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  count?: number
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-primary/10 bg-primary/10">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {count !== undefined && (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground/50">{count}</span>
          )}
        </div>
        {hint && <p className="truncate text-[11px] text-muted-foreground/50">{hint}</p>}
      </div>
      {trailing}
    </div>
  )
}

/**
 * Вкладка «Библиотека» — каталог Laby внутри лаунчера.
 *
 * Пагинация серверная: Laby принимает `size`/`offset`, поэтому страницы берутся
 * готовыми (`offset = page * size`). Общего числа записей API не отдаёт, а
 * каталог у него на миллионы записей, поэтому номеров страниц нет — только
 * переходы «назад/вперёд» по факту наличия данных.
 *
 * Фильтры (тег, текст) сервер Laby игнорирует, поэтому они применяются локально
 * по загруженному пулу — main поднимает до пяти страниц по 100 скинов.
 */
export function LabyLibraryTab() {
  const { t, i18n } = useTranslation()
  const { accounts, activeAccount } = useAccounts()
  const { pushNotification } = useActivityCenter()

  const account = activeAccount ?? accounts[0]
  const accountId = account?.id
  /** Скины Minecraft Services есть только у аккаунтов Microsoft. */
  const canApply = account?.type === "microsoft"

  const [items, setItems] = useState<LabySkin[]>([])
  const [page, setPage] = useState(0)
  /**
   * Есть ли следующая страница. Номеров страниц не считаем: Laby не отдаёт
   * общее количество, а каталог у него на миллионы записей — «страница 1 из 2»
   * было бы выдумкой. Навигация идёт по факту: сервер вернул полную страницу —
   * значит дальше есть данные.
   */
  const [hasMore, setHasMore] = useState(false)
  /**
   * Запрошенная страница оказалась за концом выдачи. Laby сообщает об этом
   * кодом 403, поэтому без отдельного флага это выглядело бы как ошибка
   * доступа — а на деле скины просто кончились.
   */
  const [endOfFeed, setEndOfFeed] = useState(false)
  const [order, setOrder] = useState<LabyOrder>(LABY_DEFAULT_ORDER)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean } | null>(null)
  const [stale, setStale] = useState(false)
  const [filteredLocally, setFilteredLocally] = useState(false)

  const [tags, setTags] = useState<LabyTag[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)

  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS)
  const [queryInput, setQueryInput] = useState("")
  const [query, setQuery] = useState("")

  const [selected, setSelected] = useState<LabySkin | null>(null)
  const [similar, setSimilar] = useState<LabySkin[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  // Игрок по введённому тексту: находится автоматически вместе с фильтром каталога.
  const [player, setPlayer] = useState<LabyPlayer | null>(null)
  const [playerLoading, setPlayerLoading] = useState(false)

  /**
   * Что из каталога уже лежит в «Избранном»: хэш → id записи в библиотеке.
   * Идентификатор нужен, чтобы снять скин с избранного прямо из каталога.
   */
  const [favorites, setFavorites] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<{ hash: string; mode: "save" | "apply" | "remove" } | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  /** Защита от гонки: ответ устаревшего запроса не должен перезаписать свежий. */
  const requestIdRef = useRef(0)

  // Дебаунс поиска: фильтрация локальная, но пул поднимается сетевыми запросами.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  /**
   * Одно поле ищет и скины, и игрока.
   *
   * Пользователю всё равно, «тег это или ник»: он вводит текст и ждёт результат.
   * Поэтому по одному запросу делаем оба дела — каталог фильтруется локально по
   * тегу/названию, а параллельно пробуем найти игрока с таким ником (точное
   * совпадение — Laby не умеет частичный поиск). Секция игрока появляется только
   * если он реально нашёлся, поэтому лишний шум не мешает обычному поиску.
   */
  useEffect(() => {
    const username = query.trim()
    // Ник — латиница, цифры, подчёркивание и точка; короче трёх символов не ищем.
    if (!window.electronAPI || username.length < 3 || !/^[A-Za-z0-9_.]+$/.test(username)) {
      setPlayer(null)
      setPlayerLoading(false)
      return
    }
    let cancelled = false
    setPlayerLoading(true)
    window.electronAPI
      .labyPlayer(username)
      .then((result) => {
        if (!cancelled) setPlayer(result)
      })
      .catch(() => {
        if (!cancelled) setPlayer(null)
      })
      .finally(() => {
        if (!cancelled) setPlayerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const loadPage = useCallback(
    async (targetPage: number, targetOrder: LabyOrder, targetFilters: CatalogFilters, targetQuery: string) => {
      if (!window.electronAPI) return
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      try {
        const result = await window.electronAPI.labyCatalog(
          targetPage,
          PAGE_SIZE,
          targetOrder,
          targetFilters.tags,
          targetQuery || null,
        )
        // Ответ устаревшего запроса отбрасываем.
        if (requestIdRef.current !== requestId) return
        setItems(result.items)
        setHasMore(result.hasMore)
        setEndOfFeed(result.endOfFeed)
        setStale(result.stale)
        setFilteredLocally(result.filteredLocally)
        setError(result.error)
      } catch (err) {
        if (requestIdRef.current !== requestId) return
        setItems([])
        setHasMore(false)
        setEndOfFeed(false)
        setError({ code: "unknown", message: String(err), retryable: true })
      } finally {
        if (requestIdRef.current === requestId) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadPage(page, order, filters, query)
  }, [loadPage, page, order, filters, query])

  // Теги Laby — единственный серверный источник категорий.
  useEffect(() => {
    let cancelled = false
    if (!window.electronAPI) return
    setTagsLoading(true)
    window.electronAPI
      .labyTags(i18n.language)
      .then((result) => {
        if (!cancelled) setTags(result)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTagsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [i18n.language])

  // Что из каталога уже лежит в «Избранном» — по sourceId из базы.
  useEffect(() => {
    let cancelled = false
    if (!accountId || !window.electronAPI) {
      setFavorites(new Map())
      return
    }
    window.electronAPI
      .skinsListLibrary(accountId)
      .then((skins) => {
        if (cancelled) return
        const map = new Map<string, string>()
        for (const skin of skins) {
          // Связь с каталогом — префикс источника; старые записи его не имеют.
          const hash = labyHashFromSourceId(skin.sourceId)
          if (hash) map.set(hash, skin.id)
        }
        setFavorites(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accountId])

  // Похожие скины для выбранного: Laby такого эндпоинта не даёт, считает main.
  useEffect(() => {
    if (!selected || !window.electronAPI) {
      setSimilar([])
      return
    }
    let cancelled = false
    setSimilarLoading(true)
    window.electronAPI
      .labySimilar(selected.hash, selected.tags, selected.slim)
      .then((result) => {
        if (!cancelled) setSimilar(result)
      })
      .catch(() => {
        if (!cancelled) setSimilar([])
      })
      .finally(() => {
        if (!cancelled) setSimilarLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const runAction = useCallback(
    async (skin: LabySkin, mode: "save" | "apply" | "remove") => {
      if (!accountId || !window.electronAPI) return
      if (mode === "apply" && !canApply) return

      // Снять с избранного можно только то, что там лежит.
      const librarySkinId = favorites.get(skin.hash)
      if (mode === "remove" && !librarySkinId) return

      setBusy({ hash: skin.hash, mode })
      try {
        if (mode === "remove" && librarySkinId) {
          const ok = await window.electronAPI.skinsDeleteFromLibrary(librarySkinId)
          if (!ok) {
            pushNotification({
              kind: "error",
              source: "import",
              title: t("laby.removeFailed", "Не удалось убрать скин из избранного"),
              message: skin.name,
            })
            return
          }
          setFavorites((prev) => {
            const next = new Map(prev)
            next.delete(skin.hash)
            return next
          })
          // Если сняли именно надетый скин, локальная метка «надет» больше не
          // действительна — иначе «Избранное» выберет несуществующую запись.
          if (localStorage.getItem(`skin-equipped-${accountId}`) === librarySkinId) {
            localStorage.removeItem(`skin-equipped-${accountId}`)
          }
          pushNotification({
            kind: "success",
            source: "import",
            title: t("laby.removed", "Скин убран из избранного"),
            message: skin.name,
          })
          return
        }

        // Модель передаём явно: скины игрока не попадают в пул каталога, и
// определить slim по метаданным там было бы неоткуда.
        const result =
          mode === "apply"
            ? await window.electronAPI.labyApply(skin.hash, accountId, skin.name, skin.slim)
            : await window.electronAPI.labySaveToLibrary(skin.hash, accountId, skin.name, skin.slim)

        if (!result.saved) {
          pushNotification({
            kind: "error",
            source: "import",
            title: t("laby.importFailed", "Не удалось получить текстуру"),
            message: skin.name,
          })
          return
        }

        if (result.librarySkinId) {
          const savedId = result.librarySkinId
          setFavorites((prev) => {
            const next = new Map(prev)
            next.set(skin.hash, savedId)
            return next
          })
        }

        if (mode === "apply") {
          if (result.applied) {
            if (result.librarySkinId) localStorage.setItem(`skin-equipped-${accountId}`, result.librarySkinId)
            pushNotification({
              kind: "success",
              source: "launch",
              title: t("laby.applied", "Скин надет и добавлен в избранное"),
              message: skin.name,
            })
          } else {
            pushNotification({
              kind: "error",
              source: "launch",
              title: t("laby.applyFailed", "Скин сохранён, но надеть не удалось"),
              message: skin.name,
            })
          }
          return
        }

        pushNotification({
          kind: "success",
          source: "import",
          title: t("laby.added", "Скин добавлен в избранное"),
          message: skin.name,
        })
      } catch (err) {
        pushNotification({
          kind: "error",
          source: "import",
          title: t("laby.error", "Каталог Laby недоступен"),
          message: String(err),
        })
      } finally {
        setBusy(null)
      }
    },
    [accountId, canApply, favorites, pushNotification, t],
  )

  const changeOrder = useCallback((next: LabyOrder) => {
    setOrder(next)
    setPage(0)
  }, [])

  const applyFilters = useCallback((next: CatalogFilters) => {
    setFilters(next)
    setPage(0)
  }, [])

  const clearQuery = useCallback(() => {
    setQueryInput("")
    setQuery("")
    setPage(0)
  }, [])

  const changePage = useCallback((next: number) => {
    setPage(next)
    gridRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  /** Скины найденного игрока в общей модели каталога. */
  const playerSkins = useMemo(
    () => (player ? player.skins.map((skin) => labyPlayerSkinToSkin(skin, player.username)) : []),
    [player],
  )

  const activeFilters = countActiveFilters(filters)
  const nothingFound = !loading && items.length === 0 && !error

  /**
   * Подсказка над сеткой. С одним тегом Laby фильтрует на сервере, и это стоит
   * показать явно: иначе непонятно, почему под тегом страниц столько же,
   * сколько всего в каталоге, а с несколькими тегами выборка заметно короче.
   */
  const catalogHint =
    filters.tags.length > 0 && !filteredLocally
      ? t("laby.catalogTagHint", "Скины Laby с тегом {{tags}}, страница за страницей", {
          tags: filters.tags.map((tag) => `#${tag}`).join(", "),
        })
      : filteredLocally
        ? t("laby.catalogFilteredHint", "Фильтр по загруженному каталогу Laby")
        : t("laby.catalogHint", "Скины из открытого API Laby, страница за страницей")

  /**
   * Показывать ли загрузку по центру.
   *
   * Условие — «показывать нечего и что-то ещё грузится»: так спиннер не мигает
   * поверх уже отрисованных скинов, а на пустом экране не мелькает сообщение
   * «ничего не подошло», пока идёт запрос игрока по тому же тексту.
   */
  const showLoader = (loading || playerLoading) && items.length === 0 && !player && !error

  const renderCards = (skins: LabySkin[]) =>
    skins.map((skin) => (
      <CatalogCard
        key={skin.hash}
        skin={skin}
        selected={selected?.hash === skin.hash}
        inFavorites={favorites.has(skin.hash)}
        canApply={Boolean(canApply)}
        busy={busy && busy.hash === skin.hash ? busy.mode : null}
        onSelect={() => setSelected(skin)}
        onSave={() => void runAction(skin, "save")}
        onRemove={() => void runAction(skin, "remove")}
        onApply={() => void runAction(skin, "apply")}
      />
    ))

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pr-1 @[820px]:grid-cols-[280px_minmax(0,1fr)] @[820px]:overflow-hidden">
        <LabyPanel
          skin={selected}
          inFavorites={selected ? favorites.has(selected.hash) : false}
          canApply={Boolean(canApply)}
          busy={busy && busy.hash === selected?.hash ? busy.mode : null}
          similar={similar}
          similarLoading={similarLoading}
          onSave={() => selected && void runAction(selected, "save")}
          onRemove={() => selected && void runAction(selected, "remove")}
          onApply={() => selected && void runAction(selected, "apply")}
          onSelectSimilar={setSelected}
        />

        <div className="flex min-h-0 flex-col gap-3 @[820px]:overflow-hidden">
          <CatalogToolbar
            query={queryInput}
            onQueryChange={setQueryInput}
            onClearQuery={clearQuery}
            order={order}
            onOrderChange={changeOrder}
            filters={filters}
            onFiltersChange={applyFilters}
            tags={tags}
            tagsLoading={tagsLoading}
            localFiltering={filteredLocally}
          />

          <div ref={gridRef} className="@container min-h-0 @[820px]:flex-1 @[820px]:overflow-y-auto @[820px]:pr-1">
            <div className="flex flex-col gap-4 pb-2">
              {/* Laby недоступен: показываем сохранённые данные, а не пустой экран. */}
              {error && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                  <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <p className="min-w-0 flex-1 text-[12px] text-amber-200/90">
                    {stale
                      ? t("laby.offlineNotice", "Не удалось обновить каталог. Показаны сохранённые данные.")
                      : error.message}
                  </p>
                  {error.retryable && (
                    <button
                      type="button"
                      onClick={() => void loadPage(page, order, filters, query)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/15"
                    >
                      <IconRefresh className="h-3.5 w-3.5" />
                      {t("laby.retry", "Повторить")}
                    </button>
                  )}
                </div>
              )}

              {/*
                Найденный игрок. Секции нет, когда игрока нет: тот же текст может
                быть обычным тегом, и сообщение «игрок не найден» только мешало бы.
              */}
              {player && (
                <section className="flex flex-col gap-2.5">
                  <PlayerHeader player={player} />
                  <SectionHeader
                    icon={<IconUsers className="h-3.5 w-3.5 text-primary/70" />}
                    title={t("laby.playerSkins", "Скины игрока")}
                    hint={t("laby.playerSkinsHint", "Вся история скинов, которую видел Laby")}
                    count={playerSkins.length}
                  />
                  <div className={GRID_CLASS}>
                    {playerSkins.length > 0 ? renderCards(playerSkins) : null}
                  </div>
                </section>
              )}

              <section className="flex flex-col gap-2.5">
                <SectionHeader
                  icon={<IconLayoutGrid className="h-3.5 w-3.5 text-primary/70" />}
                  title={t("laby.catalog", "Каталог")}
                  hint={catalogHint}
                  count={showLoader ? undefined : items.length}
                />

                {/*
                  Загрузка показывается по центру области, а не спиннером в
                  тулбаре: пока скинов нет, центр вкладки — единственное место,
                  куда смотрит пользователь.
                */}
                {showLoader ? (
                  <Spinner />
                ) : (
                  <div className={GRID_CLASS}>
                    {nothingFound ? (
                      <p className="col-span-full py-6 text-center text-[12px] text-muted-foreground/60">
                        {endOfFeed
                          ? t("laby.endOfList", "Дальше скинов нет — вернитесь на предыдущую страницу")
                          : activeFilters > 0 || query
                            ? t("laby.noMatches", "Под выбранные фильтры ничего не подошло")
                            : t("laby.empty", "Каталог вернул пустой список — попробуйте обновить")}
                      </p>
                    ) : (
                      renderCards(items)
                    )}
                  </div>
                )}

                {/* Навигация без номеров страниц: Laby не отдаёт общее количество, а
                    каталог у него на миллионы записей — «1 из 2» было бы выдумкой.
                    Вперёд пускаем, пока сервер отдаёт полные страницы, назад —
                    пока не дошли до начала. */}
                {(hasMore || page > 0) && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => changePage(page - 1)}
                      disabled={page === 0 || loading}
                      title={t("laby.prevPage", "Предыдущая страница")}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                    >
                      <IconChevronLeft className="h-4 w-4" />
                      {t("laby.prevPage", "Предыдущая страница")}
                    </button>
                    {/* «Вперёд» прячем, когда упёрлись в конец: жать её бессмысленно,
                        а неактивная кнопка только сбивает с толку. */}
                    {!endOfFeed && (
                      <button
                        type="button"
                        onClick={() => changePage(page + 1)}
                        disabled={!hasMore || loading}
                        title={t("laby.nextPage", "Следующая страница")}
                        className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                      >
                        {t("laby.nextPage", "Следующая страница")}
                        <IconChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}