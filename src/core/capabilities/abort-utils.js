export function createAbortError(reason = 'Aborted') {
  const err = new Error(reason)
  err.name = 'AbortError'
  return err
}
export function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal.reason || 'Aborted')
}

export function createMergedAbortSignal(signal, timeoutMs) {
  if (!signal && !timeoutMs) return null

  const controller = new AbortController()
  let timeoutId = null

  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }

  const onAbort = () => abort(signal?.reason || 'Aborted')
  if (signal) {
    if (signal.aborted) abort(signal.reason || 'Aborted')
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  if (timeoutMs) {
    timeoutId = setTimeout(() => abort(`Timeout ${timeoutMs}ms`), timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeoutId) clearTimeout(timeoutId)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}
