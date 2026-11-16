import type { IpcInvokeMap } from "@xnlc/types"
// ============================================================
// XNLC — Declarative IPC Router
// Replaces manual rpcRegistry.handle boilerplate with a declarative
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
//   • `rawHandler` / прямой `rpcRegistry.handle` — для всего остального (файлы,
//     БД, облако, серверы): ошибка прокидывается вызывающему, и renderer
//     показывает её пользователю. Прямой `rpcRegistry.handle` в 13 модулях — это
//     тот же `rawHandler`, только без обёртки; обёртка нужна лишь там, где
//     полезно единое описание набора каналов.
//
// Единый стиль «всё через router» сознательно не вводится: он не меняет
// поведение, но требует переписать ~215 регистраций и рискует регрессиями.

import { rpcRegistry } from "../platform/desktop"
import { callHandler, getHandler } from "./minecraft-core"
import type { XnlcHandler } from "@xnlc/core" with { "resolution-mode": "import" }

/**
 * A handler definition that uses the XnlcHandler context.
 * Errors are caught and the fallback is returned.
 */
export type ContextHandlerDef<TResult> = {
  channel: keyof IpcInvokeMap
  label: string
  fallback: TResult
  handler: (ctx: XnlcHandler, ...args: unknown[]) => Promise<TResult>
}

/**
 * A raw handler definition that doesn't need XnlcHandler context.
 * Errors propagate to the caller (rejected promise).
 */
export type RawHandlerDef<TResult> = {
  channel: keyof IpcInvokeMap
  handler: (...args: unknown[]) => Promise<TResult>
}

/**
 * Union of all handler definition types.
 */
export type IpcHandlerDef = { register(): void }

/**
 * Register an array of declarative IPC handlers.
 */
export function registerIpcHandlers(handlers: IpcHandlerDef[]): void {
  for (const entry of handlers) entry.register()
}

/**
 * Helper to create a context handler definition.
 */
export function ctxHandler<C extends keyof IpcInvokeMap>(
  channel: C,
  label: string,
  fallback: NoInfer<IpcInvokeMap[C]["return"]>,
  handler: NoInfer<(ctx: XnlcHandler, ...args: IpcInvokeMap[C]["args"]) => Promise<IpcInvokeMap[C]["return"]>>,
): IpcHandlerDef {
  return { register() {
    rpcRegistry.handle(channel, (_event, ...args) => callHandler(label, fallback, ctx => handler(ctx, ...args)))
  } }
}

/**
 * Helper to create a raw handler definition (no XnlcHandler context).
 */
export function rawHandler<C extends keyof IpcInvokeMap>(
  channel: C,
  handler: NoInfer<(...args: IpcInvokeMap[C]["args"]) => Promise<IpcInvokeMap[C]["return"]>>,
): IpcHandlerDef {
  return { register() { rpcRegistry.handle(channel, (_event, ...args) => handler(...args)) } }
}
