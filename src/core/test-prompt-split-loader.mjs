// ESM resolve+load hook for test-prompt-split.js.
//
// Intercepts the import of ./agents/registry.js (transitive from prompt.js)
// and serves a minimal stub that returns '' for buildAgentContextBlock. The
// real registry calls into the SQLite-backed db, which we want to avoid in
// this standalone prompt-shape sanity test.

const STUB_SOURCE = `
export function buildAgentContextBlock() { return '' }
export function buildDelegationAskDirections() { return null }
export function collectAgents() { return Promise.resolve([]) }
export function isDelegationAllowed() { return false }
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('agents/registry.js')) {
    return { url: 'stub:agents-registry', shortCircuit: true, format: 'module' }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'stub:agents-registry') {
    return { format: 'module', shortCircuit: true, source: STUB_SOURCE }
  }
  return nextLoad(url, context)
}
