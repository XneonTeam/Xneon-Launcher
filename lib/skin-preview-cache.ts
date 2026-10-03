// ============================================================
// Превью скинов для сетки «Избранного».
//
// Раньше каждая карточка поднимала свой `SkinViewer3D`, то есть отдельный
// WebGL-контекст. При быстром скролле карточки монтировались и размонтировались
// десятками, а `renderer.dispose()` контекст не уничтожает — браузерный лимит
// (~16 живых контекстов на страницу) исчерпывался, старые контексты терялись
// («webglcontextlost»), и превью гасли: визуально скины пропадали.
//
// Теперь скины рисует один общий вьюер вне DOM, а карточки показывают готовые
// картинки из кэша. Контекст один, скролл ничего не создаёт и не теряет,
// а повторный показ не требует ни WebGL, ни повторной загрузки текстуры.
// ============================================================

import { SkinViewer } from "skinview3d"

/** Размер снимка: карточка в сетке — примерно 180×230 CSS-пикселя. */
const PREVIEW_W = 216
const PREVIEW_H = 280
/** Сколько картинок держим в памяти (LRU). */
const PREVIEW_CACHE_LIMIT = 400

export interface SkinPreviewJob {
  key: string
  skinUrl: string
  capeUrl?: string | null
  slim: boolean
  backEquipment?: "cape" | "elytra"
  faceBack?: boolean
}

type QueuedJob = SkinPreviewJob & { resolve: (value: string | null) => void }

const previewCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()
/** Видимые карточки рисуем первыми: при быстром скролле это то, что на экране. */
const highPriorityQueue: QueuedJob[] = []
const lowPriorityQueue: QueuedJob[] = []

let viewer: SkinViewer | null = null
let draining = false

/**
 * Ключ кэша. `version` подставляется из вкладки скинов и растёт после правок,
 * сброса и удаления — иначе после редактирования скина карточка показывала бы
 * старую картинку.
 */
export function skinPreviewCacheKey(
  skinUrl: string,
  variant: string,
  capeUrl?: string | null,
  version = 0,
): string {
  return `${skinUrl}|${variant}|${capeUrl ?? ""}|v${version}`
}

/** Готовое превью из кэша — синхронно, чтобы карточка не мигала при возврате. */
export function readSkinPreview(key: string): string | null {
  return previewCache.get(key) ?? null
}

export function clearSkinPreviews(): void {
  previewCache.clear()
}

function ensureViewer(): SkinViewer | null {
  if (viewer) return viewer
  if (typeof document === "undefined") return null

  const canvas = document.createElement("canvas")
  canvas.width = PREVIEW_W
  canvas.height = PREVIEW_H
  // Контекст общего вьюера тоже может потеряться (драйвер, смена GPU). Тогда
  // вьюер выбрасываем: следующая задача создаст новый, а уже снятые картинки
  // остаются в кэше и ничего не теряют.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault()
    viewer = null
  }, false)

  const instance = new SkinViewer({ canvas, width: PREVIEW_W, height: PREVIEW_H })
  // Кадры снимаем вручную: постоянный rAF-цикл на скрытом канвасе не нужен.
  instance.animation = null
  instance.autoRotate = false
  viewer = instance
  return instance
}

async function renderPreview(job: SkinPreviewJob): Promise<string | null> {
  const instance = ensureViewer()
  if (!instance) return null

  await instance.loadSkin(job.skinUrl, { model: job.slim ? "slim" : "default" })
  if (job.capeUrl) {
    await instance.loadCape(job.capeUrl, { backEquipment: job.backEquipment ?? "cape" })
  } else {
    instance.resetCape()
  }
  instance.playerWrapper.rotation.y = job.faceBack ? Math.PI : 0

  // Рисуем и снимаем кадр без паузы: буфер отрисовки живёт до следующего кадра,
  // а текстуры к этому моменту уже загружены (`loadSkin`/`loadCape` выше).
  instance.render()
  const dataUrl = (instance.canvas as HTMLCanvasElement).toDataURL("image/png")
  return dataUrl && dataUrl.length > 128 ? dataUrl : null
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    for (;;) {
      const job = highPriorityQueue.shift() ?? lowPriorityQueue.shift()
      if (!job) return

      let result: string | null = null
      try {
        result = await renderPreview(job)
      } catch {
        result = null
      }

      if (result) {
        previewCache.set(job.key, result)
        if (previewCache.size > PREVIEW_CACHE_LIMIT) {
          const oldest = previewCache.keys().next().value
          if (oldest !== undefined) previewCache.delete(oldest)
        }
      }

      inFlight.delete(job.key)
      job.resolve(result)
    }
  } finally {
    draining = false
  }
}

/**
 * Просит превью скина. Повторные просьбы на тот же ключ ждут одну отрисовку.
 * `priority` — карточка на экране: такие задачи идут вперёд очереди.
 */
export function requestSkinPreview(job: SkinPreviewJob, priority = false): Promise<string | null> {
  const cached = previewCache.get(job.key)
  if (cached) return Promise.resolve(cached)

  const running = inFlight.get(job.key)
  if (running) return running

  const promise = new Promise<string | null>((resolve) => {
    const queued: QueuedJob = { ...job, resolve }
    if (priority) highPriorityQueue.push(queued)
    else lowPriorityQueue.push(queued)
    void drainQueue()
  })
  inFlight.set(job.key, promise)
  return promise
}
