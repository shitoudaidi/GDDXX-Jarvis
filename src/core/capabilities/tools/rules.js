import { classifyRuleRisk, deriveTrust, normalizeRuleSourceKind, normalizeStatusForSource } from '../../context/rule-risk.js'
import { deleteRule, loadAutomationRules, loadContextRules, normalizeRule, updateRule, upsertRule } from '../../context/rule-store.js'

function toolJson(value) {
  return JSON.stringify(value, null, 2)
}

function normalizeKind(value = 'context') {
  return String(value || '').trim().toLowerCase() === 'automation' ? 'automation' : 'context'
}

function slugifyId(value = '') {
  const raw = String(value || '').trim().toLowerCase()
  const ascii = raw.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return ascii || `rule_${Date.now()}`
}

function summarizeRule(rule) {
  const command = rule.command || rule.script || rule.code || rule.action?.command || rule.action?.script || rule.action?.code || ''
  return {
    id: rule.id,
    kind: rule.kind,
    provider: rule.provider,
    enabled: rule.enabled,
    status: rule.status,
    risk: rule.risk || classifyRuleRisk(rule),
    source_kind: rule.source_kind,
    patterns: rule.patterns,
    context: rule.context ? String(rule.context).slice(0, 500) : undefined,
    command_preview: command ? String(command).slice(0, 300) : undefined,
  }
}

function normalizeProposedRule(args = {}) {
  const raw = args.rule && typeof args.rule === 'object' ? args.rule : args
  const kind = normalizeKind(args.kind || raw.kind)
  const provider = String(raw.provider || raw.action?.type || '').trim()
  const id = slugifyId(raw.id || raw.name || provider)
  return normalizeRule({
    ...raw,
    id,
    kind,
    provider,
    patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
  }, kind)
}

function listRules(kind) {
  const rules = kind === 'automation' ? loadAutomationRules() : loadContextRules()
  return toolJson({
    ok: true,
    action: 'list',
    kind,
    rules: rules.map(summarizeRule),
  })
}

function proposeRule(args = {}) {
  const kind = normalizeKind(args.kind || args.rule?.kind)
  const sourceKind = normalizeRuleSourceKind(args.source_kind)
  const proposed = normalizeProposedRule({ ...args, kind })
  if (!proposed) {
    return toolJson({
      ok: false,
      error: 'invalid rule: id/name, provider/action.type, and patterns are required',
    })
  }

  const risk = classifyRuleRisk(proposed)
  const trust = deriveTrust(sourceKind)
  const status = normalizeStatusForSource({ rule: proposed, sourceKind, risk })
  const rule = {
    ...proposed,
    risk,
    trust,
    source_kind: sourceKind,
    status: status.status,
    enabled: status.enabled,
    updated_at: new Date().toISOString(),
  }

  upsertRule(kind, rule)
  return toolJson({
    ok: true,
    action: 'propose',
    kind,
    rule: summarizeRule(rule),
    policy: {
      risk,
      trust,
      activated: rule.enabled,
      reason: status.reason,
    },
  })
}

function setRuleEnabled(kind, id, enabled, confirmed = false) {
  if (enabled) {
    const rules = kind === 'automation' ? loadAutomationRules() : loadContextRules()
    const existing = rules.find(rule => rule.id === String(id || '').trim())
    if (!existing) throw new Error(`rule "${id}" was not found`)
    const risk = existing.risk || classifyRuleRisk(existing)
    if ((risk === 'high' || existing.source_kind === 'external_content') && confirmed !== true) {
      throw new Error('high-risk or external-content rules require confirmed=true after explicit user approval')
    }
  }
  const patch = {
    enabled: Boolean(enabled),
    status: enabled ? 'active' : 'draft',
    updated_at: new Date().toISOString(),
  }
  const { rule } = updateRule(kind, id, patch)
  return toolJson({
    ok: true,
    action: enabled ? 'enable' : 'disable',
    kind,
    rule: summarizeRule(rule),
  })
}

export function execManageRule(args = {}) {
  const action = String(args.action || 'list').trim().toLowerCase()
  const kind = normalizeKind(args.kind)
  try {
    if (action === 'list') return listRules(kind)
    if (action === 'propose' || action === 'upsert') return proposeRule(args)
    if (action === 'enable') return setRuleEnabled(kind, args.id, true, args.confirmed === true)
    if (action === 'disable') return setRuleEnabled(kind, args.id, false)
    if (action === 'delete') {
      deleteRule(kind, args.id)
      return toolJson({ ok: true, action: 'delete', kind, id: args.id })
    }
    return toolJson({ ok: false, error: `unknown action "${action}"` })
  } catch (err) {
    return toolJson({ ok: false, action, kind, error: err.message })
  }
}
