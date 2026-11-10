import { EventEmitter } from "node:events"

/** Фоновое обогащение не меняет файлы: уведомляем открытый список отдельно. */
export const contentMetadataEvents = new EventEmitter()
