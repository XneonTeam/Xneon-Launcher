/*
 * Единый барьер асинхронного завершения лаунчера.
 *
 * Раньше каждая подсистема сама слушала `before-quit`, вызывала
 * `event.preventDefault()` и по завершении снова звала `app.quit()`. Из-за
 * этого первая же закончившаяся задача снимала блокировку нативного выхода,
 * не дожидаясь соседних: временные файлы могли остаться, MCP-клиенты — не
 * закрыться, БД — не получить чекпойнт. Здесь один владелец: модули
 * регистрируют задачу через `registerShutdownTask`, а `app.quit()` запускает
 * их все ровно один раз и только после этого отдаёт управление нативному слою.
 *
 * Модуль намеренно не импортирует Electrobun: выход и таймеры инжектируются,
 * поэтому сценарий проверяется обычным тестом без запуска приложения.
 */

/** Общий дедлайн cleanup. После него выход выполняется принудительно. */
export const DEFAULT_SHUTDOWN_DEADLINE_MS = 8_500

/**
 * Приоритеты задач: чем больше число, тем раньше задача выполняется.
 * Задачи с одинаковым приоритетом идут параллельно, группы — последовательно,
 * поэтому закрытие БД (`0`) всегда происходит после сетевых и файловых задач.
 */
export const SHUTDOWN_PRIORITY = {
  /** Ранние уведомления и координация с другими процессами. */
  notice: 1_000,
  /** Сетевые клиенты: MCP, relay, remote-серверы, Discord RPC. */
  network: 800,
  /** Наблюдатели файлов и подписки. */
  watchers: 600,
  /** Временные файлы и прочие ресурсы на диске. */
  files: 400,
  /** Сброс и закрытие базы — последним шагом. */
  database: 0,
} as const

export type ShutdownTaskOptions = {
  /** Чем больше, тем раньше задача выполняется. По умолчанию `SHUTDOWN_PRIORITY.network`. */
  priority?: number
  /** Предел ожидания одной задачи. `0` — ограничен только общим дедлайном. */
  timeoutMs?: number
}

export type ShutdownFailure = { name: string; error: unknown }

export type ShutdownOutcome = {
  /** Причина запуска (`quit`, `restart`, …) — только для диагностики. */
  reason: string
  /** `deadline` — общий дедлайн истёк, часть задач не успела. */
  status: "completed" | "deadline"
  failed: ShutdownFailure[]
  /** Задачи, не уложившиеся в собственный `timeoutMs`. */
  timedOut: string[]
  /** Задачи, до которых не дошла очередь из-за общего дедлайна. */
  skipped: string[]
  elapsedMs: number
}

export type ShutdownTimers = {
  setTimeout: (handler: () => void, timeoutMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type ShutdownCoordinatorOptions = {
  deadlineMs?: number
  timers?: ShutdownTimers
  log?: (message: string) => void
  now?: () => number
}

type ShutdownTask = {
  name: string
  run: (reason: string) => unknown
  priority: number
  timeoutMs: number
  order: number
}

const TASK_TIMEOUT = Symbol("shutdown-task-timeout")

export class ShutdownCoordinator {
  readonly deadlineMs: number
  private readonly timers: ShutdownTimers
  private readonly log: (message: string) => void
  private readonly now: () => number
  private readonly tasks: ShutdownTask[] = []
  private registrations = 0
  private exitHandler?: (outcome: ShutdownOutcome) => void
  private outcome?: ShutdownOutcome
  private pending?: Promise<ShutdownOutcome>
  private running?: Promise<ShutdownOutcome>

  constructor(options: ShutdownCoordinatorOptions = {}) {
    this.deadlineMs = options.deadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS
    this.timers = options.timers ?? { setTimeout, clearTimeout }
    this.log = options.log ?? (message => console.warn(`[Shutdown] ${message}`))
    this.now = options.now ?? (() => Date.now())
  }

  /** Shutdown уже запущен (или завершён) — повторный запуск ничего не делает. */
  get started(): boolean {
    return this.pending !== undefined
  }

  /** Cleanup завершён и выход передан наружу. */
  get finished(): boolean {
    return this.outcome !== undefined
  }
  get exiting(): boolean { return this.running !== undefined }

  /** Вызывается ровно один раз после cleanup — здесь нативный выход. */
  onExit(handler: (outcome: ShutdownOutcome) => void): void {
    this.exitHandler = handler
  }

  /**
   * Регистрирует задачу завершения. Возвращает функцию отмены регистрации.
   * Задача, зарегистрированная после начала shutdown, не выполняется: вызывать
   * `run` из неё уже поздно, а молчаливое добавление ломало бы дедлайн.
   */
  register(name: string, run: (reason: string) => unknown, options: ShutdownTaskOptions = {}): () => void {
    if (!name || typeof run !== "function") throw new TypeError("Shutdown task needs a name and a function")
    if (this.started) {
      this.log(`task "${name}" registered after shutdown started; ignored`)
      return () => {}
    }
    const task: ShutdownTask = {
      name,
      run,
      priority: options.priority ?? SHUTDOWN_PRIORITY.network,
      timeoutMs: options.timeoutMs ?? 0,
      order: this.registrations++,
    }
    this.tasks.push(task)
    return () => {
      if (this.started) return
      const index = this.tasks.indexOf(task)
      if (index >= 0) this.tasks.splice(index, 1)
    }
  }

  /**
   * Запускает cleanup один раз. Повторный вызов (в том числе из обработчика
   * `before-quit`, пришедшего от нативного слоя) возвращает тот же promise и не
   * перезапускает задачи.
   */
  run(reason = "quit"): Promise<ShutdownOutcome> {
    if (!this.running) this.running = this.prepare(reason).then(outcome => {
      this.exitHandler?.(outcome)
      return outcome
    })
    return this.running
  }

  /** SDK update сначала готовит ресурсы, а нативный выход выполняет после approval. */
  prepare(reason = "update"): Promise<ShutdownOutcome> {
    if (!this.pending) this.pending = this.execute(reason)
    return this.pending
  }

  resetAfterCancelledUpdate(): void {
    if (this.running || this.pending && !this.outcome) throw new Error("Shutdown cannot be reset while running")
    this.pending = undefined
    this.outcome = undefined
  }

  private async execute(reason: string): Promise<ShutdownOutcome> {
    const startedAt = this.now()
    const failed: ShutdownFailure[] = []
    const timedOut: string[] = []
    const skipped: string[] = []
    let deadlineReached = false
    let deadlineTimer: unknown
    const deadlineSignal = new Promise<void>(resolve => {
      deadlineTimer = this.timers.setTimeout(() => {
        deadlineReached = true
        resolve()
      }, this.deadlineMs)
    })

    const groups: ShutdownTask[][] = []
    for (const task of [...this.tasks].sort((left, right) => right.priority - left.priority || left.order - right.order)) {
      const group = groups[groups.length - 1]
      if (group && group[0].priority === task.priority) group.push(task)
      else groups.push([task])
    }

    try {
      for (const group of groups) {
        if (deadlineReached) {
          // Дедлайн уже истёк: не начинаем новые задачи, но и не ждём их.
          skipped.push(...group.map(task => task.name))
          continue
        }
        await Promise.race([
          Promise.all(group.map(task => this.runTask(task, reason, failed, timedOut))),
          deadlineSignal,
        ])
      }
    } finally {
      this.timers.clearTimeout(deadlineTimer)
    }

    const outcome: ShutdownOutcome = {
      reason,
      status: deadlineReached ? "deadline" : "completed",
      failed,
      timedOut,
      skipped,
      elapsedMs: this.now() - startedAt,
    }
    this.outcome = outcome

    if (outcome.status === "deadline") this.log(`cleanup deadline of ${this.deadlineMs} ms reached; forcing exit`)
    else if (failed.length || timedOut.length) this.log(`cleanup finished with ${failed.length} failure(s) and ${timedOut.length} timeout(s)`)

    return outcome
  }

  /** Ошибка или зависание одной задачи не мешает остальным и не отменяет выход. */
  private async runTask(task: ShutdownTask, reason: string, failed: ShutdownFailure[], timedOut: string[]): Promise<void> {
    const work = Promise.resolve().then(() => task.run(reason))
    // Задача, завершившаяся после дедлайна, не должна ронять процесс
    // необработанным отказом: результат уже никого не интересует.
    work.catch(() => {})

    let timer: unknown
    const timeoutSignal = new Promise<typeof TASK_TIMEOUT>(resolve => {
      if (task.timeoutMs > 0 && Number.isFinite(task.timeoutMs)) {
        timer = this.timers.setTimeout(() => resolve(TASK_TIMEOUT), task.timeoutMs)
      }
    })

    try {
      const result = await Promise.race([work, timeoutSignal])
      if (result === TASK_TIMEOUT) {
        timedOut.push(task.name)
        this.log(`task "${task.name}" timed out after ${task.timeoutMs} ms`)
      }
    } catch (error) {
      failed.push({ name: task.name, error })
      this.log(`task "${task.name}" failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (timer !== undefined) this.timers.clearTimeout(timer)
    }
  }
}

/** Единственный координатор приложения; выход настраивает `platform/desktop.ts`. */
export const launcherShutdown = new ShutdownCoordinator()

/**
 * Регистрирует задачу завершения приложения. Выполняется после `app.quit()`
 * и до нативного выхода; ошибки и таймауты не отменяют остальные задачи.
 */
export function registerShutdownTask(name: string, run: (reason: string) => unknown, options: ShutdownTaskOptions = {}): () => void {
  return launcherShutdown.register(name, run, options)
}
