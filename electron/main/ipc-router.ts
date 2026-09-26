// ============================================================
// XNLC — Declarative IPC Router
// Replaces manual ipcMain.handle boilerplate with a declarative
// registration system.
// ============================================================
//
// ГДЕ КАКОЙ СТИЛЬ ИСПОЛЬЗОВАТЬ
//
// Каналы регистрируются двумя способами, и это осознанное разделение, а не
// исторический разнобой:
//
//   • `ctxHandler` — когда обработчику нужен контекст XnlcHandler (движок
//     @xnlc/core: версии, авторизация, запуск). При ошибке возвращается
//     `fallback` (пустой список/`null`), а сама ошибка пишется в runtime-лог:
//     для каналов-«списков» пустой ответ — валидное состояние UI, но сбой
//     должен быть виден на странице «Логи» (см. `callHandler`).
//
//   • `rawHandler` / прямой `ipcMain.handle` — для всего остального (файлы,
//     БД, облако, серверы): ошибка прокидывается вызывающему, и renderer
//     показывает её пользователю. Прямой `ipcMain.handle` в 13 модулях — это
//     тот же `rawHandler`, только без обёртки; обёртка нужна лишь там, где
//     полезно единое описание набора каналов.
//
// Единый стиль «всё через router» сознательно не вводится: он не меняет
// поведение, но требует переписать ~215 регистраций и рискует регрессиями.

import { ipcMain } from "electron"
import { callHandler, getHandler } from "./minecraft-core"
import type { XnlcHandler } from "@xnlc/core" with { "resolution-mode": "import" }

/**
 * A handler definition that uses the XnlcHandler context.
 * Errors are caught and the fallback is returned.
 */
export type ContextHandlerDef<TResult> = {
  channel: string
  label: string
  fallback: TResult
  handler: (ctx: XnlcHandler, ...args: unknown[]) => Promise<TResult>
}

/**
 * A raw handler definition that doesn't need XnlcHandler context.
 * Errors propagate to the caller (rejected promise).
 */
export type RawHandlerDef<TResult> = {
  channel: string
  handler: (...args: unknown[]) => Promise<TResult>
}

/**
 * Union of all handler definition types.
 */
export type IpcHandlerDef =
  | { type: "context"; def: ContextHandlerDef<unknown> }
  | { type: "raw"; def: RawHandlerDef<unknown> }

/**
 * Register an array of declarative IPC handlers.
 */
export function registerIpcHandlers(handlers: IpcHandlerDef[]): void {
  for (const entry of handlers) {
    if (entry.type === "context") {
      const { channel, label, fallback, handler } = entry.def
      ipcMain.handle(channel, async (_event, ...args: unknown[]) =>
        callHandler(label, fallback, (ctx) => handler(ctx, ...args)),
      )
    } else {
      const { channel, handler } = entry.def
      ipcMain.handle(channel, async (_event, ...args: unknown[]) =>
        handler(...args),
      )
    }
  }
}

/**
 * Helper to create a context handler definition.
 */
export function ctxHandler<TResult>(
  channel: string,
  label: string,
  fallback: TResult,
  handler: (ctx: XnlcHandler, ...args: unknown[]) => Promise<TResult>,
): IpcHandlerDef {
  return { type: "context", def: { channel, label, fallback, handler } }
}

/**
 * Helper to create a raw handler definition (no XnlcHandler context).
 */
export function rawHandler<TResult>(
  channel: string,
  handler: (...args: unknown[]) => Promise<TResult>,
): IpcHandlerDef {
  return { type: "raw", def: { channel, handler } }
}
