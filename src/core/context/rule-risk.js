const HIGH_RISK_PATTERNS = [
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bInvoke-RestMethod\b/i,
  /\bInvoke-Expression\b/i,
  /\biex\b/i,
  /\bRemove-Item\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[fsq]\b/i,
  /\brd\s+\/s\b/i,
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\.ssh\b/i,
  /\bid_rsa\b/i,
  /\bprivate[-_ ]?key\b/i,
  /\bpassword\b/i,
  /\bpasswd\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bcookie\b/i,
  /\bapi[-_ ]?key\b/i,
  /\|\s*(?:sh|bash|powershell|pwsh|cmd)\b/i,
]

const MEDIUM_RISK_PATTERNS = [
  /\bnode\b/i,
  /\bpython\b/i,
  /\bpowershell\b/i,
  /\bpwsh\b/i,
  /\bcmd\b/i,
  /\bnpm\b/i,
  /\bpnpm\b/i,
  /\byarn\b/i,
  /\bgit\b/i,
  /\bhttp:\/\//i,
  /\bhttps:\/\//i,
]

export function normalizeRuleSourceKind(value = '') {
  const sourceKind = String(value || '').trim().toLowerCase()
  if (['direct_user_request', 'agent_observation', 'external_content'].includes(sourceKind)) return sourceKind
  return 'agent_observation'
}

export function deriveTrust(sourceKind = '') {
  switch (normalizeRuleSourceKind(sourceKind)) {
    case 'direct_user_request':
      return 'high'
    case 'external_content':
      return 'low'
    default:
      return 'medium'
  }
}

function commandText(rule = {}) {
  const action = rule.action && typeof rule.action === 'object' ? rule.action : {}
  return [
    rule.command,
    rule.script,
    rule.code,
    action.command,
    action.script,
    action.code,
  ].filter(Boolean).join('\n')
}

export function classifyRuleRisk(rule = {}) {
  const provider = String(rule.provider || rule.action?.type || '').trim().toLowerCase()
  const text = commandText(rule)

  if (provider === 'script' || provider === 'shell' || provider === 'command') {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(text)) return 'high'
    }
    for (const pattern of MEDIUM_RISK_PATTERNS) {
      if (pattern.test(text)) return 'medium'
    }
    return 'medium'
  }

  if (provider === 'local_resources') return 'medium'
  if (provider === 'weather' || provider === 'static_text' || provider === 'time') return 'low'
  return 'medium'
}

export function normalizeStatusForSource({ rule = {}, sourceKind = 'agent_observation', risk = null } = {}) {
  const normalizedSource = normalizeRuleSourceKind(sourceKind)
  const normalizedRisk = risk || classifyRuleRisk(rule)

  if (normalizedSource === 'external_content') {
    return { status: 'draft', enabled: false, reason: 'rules derived from external content require user approval' }
  }
  if (normalizedRisk === 'high') {
    return { status: 'draft', enabled: false, reason: 'high-risk rules require explicit user approval before activation' }
  }
  if (normalizedSource === 'direct_user_request') {
    return { status: 'active', enabled: true, reason: 'direct user request with acceptable risk' }
  }
  return { status: 'draft', enabled: false, reason: 'agent-observed rules start as drafts' }
}
