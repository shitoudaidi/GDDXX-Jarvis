export function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}
export function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function previewValue(value, max = 180) {
  const text = typeof value === 'string' ? value : safeJsonStringify(value)
  const compact = compactWhitespace(text)
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}
