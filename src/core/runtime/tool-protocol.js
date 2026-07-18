export const TERMINAL_INTERNAL_TOOLS = new Set([
  'skip_recognition',
  'skip_consolidation',
])

export function isTerminalInternalToolRound(toolCalls = [], { mustReply = false } = {}) {
  if (mustReply) return false
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false
  return toolCalls.every(tc => TERMINAL_INTERNAL_TOOLS.has(tc?.name))
}
