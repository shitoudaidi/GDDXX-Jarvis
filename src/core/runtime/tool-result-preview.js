export function compactToolPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.slice(0, 10).map(compactToolPayload)
  }
  if (payload && typeof payload === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === 'string' && v.length > 600) {
        const cut = v.slice(0, 600)
        out[k] = `${cut}…（已截断，原 ${v.length} 字符）`
      } else if (v && typeof v === 'object') {
        out[k] = compactToolPayload(v)
      } else {
        out[k] = v
      }
    }
    return out
  }
  return payload
}

// Compress tool results into frontend-safe JSON where possible.
// Slicing raw JSON in the middle makes the thought-stream formatter fall back to
// broken plain text, so object payloads are compacted structurally first.
export function truncateToolResultForUI(parsed, raw) {
  if (parsed && typeof parsed === 'object') {
    const compact = compactToolPayload(parsed)
    const out = JSON.stringify(compact)
    if (out.length <= 4000) return out
    return out.slice(0, 4000)
  }
  return String(raw ?? '').slice(0, 1000)
}
