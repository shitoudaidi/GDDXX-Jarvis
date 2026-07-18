export function env(name) {
  return String(globalThis.process?.env?.[name] || '').trim()
}
