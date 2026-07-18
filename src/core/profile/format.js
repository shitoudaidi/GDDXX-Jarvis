function pct(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`
}

function list(items, map = x => x, limit = 5) {
  return (items || []).slice(0, limit).map(map).filter(Boolean)
}

export function formatUserProfileForPrompt(profile) {
  if (!profile || (!profile.summary && !profile.roles?.length)) return ''

  const lines = []
  lines.push('Current working impression of the user. This is decision support, not a fact about the user. Use it to adjust explanation depth, defaults, and examples. If the user says something that conflicts with this profile, trust the user and update your behavior immediately.')

  if (profile.summary) lines.push(`Summary: ${profile.summary}`)

  const roles = list(profile.roles, role => {
    const evidence = list(role.evidence, x => x, 3)
    const suffix = evidence.length ? `; evidence: ${evidence.join('; ')}` : ''
    return `- ${role.label} (${pct(role.confidence)} confidence, ${role.status || 'hypothesis'}${suffix})`
  }, 4)
  if (roles.length) lines.push(`Likely roles:\n${roles.join('\n')}`)

  const domains = list(profile.domains, x => x, 8)
  if (domains.length) lines.push(`Likely domains: ${domains.join(', ')}`)

  const projects = list(profile.projects, x => x, 6)
  if (projects.length) lines.push(`Relevant projects: ${projects.join(', ')}`)

  const expertise = list(profile.expertise, item => `${item.label} (${pct(item.confidence)})`, 4)
  if (expertise.length) lines.push(`Inferred knowledge level: ${expertise.join(', ')}`)

  const style = list(profile.communication_style, item => `${item.label} (${pct(item.confidence)})`, 4)
  if (style.length) lines.push(`Interaction preferences: ${style.join(', ')}`)

  if (profile.updated_at) lines.push(`Updated at: ${profile.updated_at}`)
  return lines.join('\n')
}
