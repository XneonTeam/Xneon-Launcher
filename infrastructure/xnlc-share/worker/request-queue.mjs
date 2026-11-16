/** Загрузка тела не держит очередь метаданных. Одновременно буферизуем лишь одно тело. */
export class ShareRequestQueue {
  metadata = Promise.resolve()
  bodies = Promise.resolve()
  serialized(callback) {
    const result = this.metadata.then(callback)
    this.metadata = result.catch(() => {})
    return result
  }
  dispatch(request, prepare, handle) {
    const execute = async () => {
      request.signal?.throwIfAborted()
      const prepared = await prepare(request)
      return this.serialized(() => { request.signal?.throwIfAborted(); return handle(prepared) })
    }
    if (!request.body) return execute()
    const result = this.bodies.then(execute)
    this.bodies = result.catch(() => {})
    return result
  }
}

export async function readLimitedBody(request, max) {
  request.signal?.throwIfAborted()
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  const abort = () => { void reader.cancel(request.signal.reason).catch(() => {}) }
  request.signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      request.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel('Request body exceeds limit')
        throw Object.assign(new Error('Request body exceeds limit'), { code: 'SIZE' })
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
    request.signal?.throwIfAborted()
    return Buffer.concat(chunks, size)
  } finally {
    request.signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
