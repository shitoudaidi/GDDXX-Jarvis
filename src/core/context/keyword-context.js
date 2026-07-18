import { runContextRuleEngine } from './rule-engine.js'

export async function buildKeywordRuntimeContext(message = '') {
  return await runContextRuleEngine(message)
}
