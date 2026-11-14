/** Один import для prefetch и React.lazy; ошибка не мешает повторной попытке. */
export type PageLoader<T> = (() => Promise<T>) & { peek(): T | undefined }

export function createPageLoader<T>(load: () => Promise<T>): PageLoader<T> {
  let pending: Promise<T> | undefined
  let loaded: T | undefined
  const get = () => {
    if (!pending) pending = load().then(value => { loaded = value; return value }).catch(error => { pending = undefined; throw error })
    return pending
  }
  return Object.assign(get, { peek: () => loaded })
}
