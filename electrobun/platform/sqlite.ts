import { Database } from "bun:sqlite"
import type { SQLQueryBindings } from "bun:sqlite"

export default class LauncherDatabase extends Database {
  constructor(filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }) {
    super(filename, { readonly: options?.readonly, create: !options?.fileMustExist })
  }

  pragma(expression: string, options?: { simple?: boolean }): unknown {
    const query = this.query<Record<string, unknown>, SQLQueryBindings[]>("PRAGMA " + expression)
    const rows = query.all()
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows
  }
}
