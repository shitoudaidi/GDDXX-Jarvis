import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

let failed = 0
function assert(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`)
  } else {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempUserDir = fs.mkdtempSync(path.join(repoRoot, 'sandbox', 'active-policy-test-'))
process.env.JARVIS_USER_DIR = tempUserDir
process.env.USERPROFILE = tempUserDir
process.env.HOME = tempUserDir

try {
  const db = await import('./db.js')
  const { runInjector, formatActivePoliciesForPrompt } = await import('./memory/injector.js')
  const { buildContextBlock } = await import('./prompt.js')

  db.getDB()
  const ts = '2026-06-11T00:00:00+08:00'

  db.upsertMemoryByMemId({
    mem_id: 'procedure_desktop_capture_dpi_aware',
    type: 'knowledge',
    title: 'DPI-aware desktop capture',
    content: 'For screenshots, must call SetProcessDPIAware and capture physical 2880x1800 pixels; do not trust logical 1920x1200.',
    detail: 'When fullscreen, F11, or window capture is requested, verify the captured image dimensions before sending it.',
    entities: ['agent:jarvis'],
    tags: ['kind:procedure', 'domain:desktop_control', 'trigger:screenshot', 'trigger:fullscreen', 'trigger:dpi', 'trigger:window'],
    salience: 5,
    timestamp: ts,
  })

  db.upsertMemoryByMemId({
    mem_id: 'knowledge_legacy_screenshot_method',
    type: 'knowledge',
    title: 'Legacy screenshot method',
    content: 'Screenshot method: must call SetProcessDPIAware before capture and use physical pixel bounds when DPI scaling is enabled.',
    detail: 'This is an older untagged method memory that should still be activated by text cues and domain terms.',
    entities: ['agent:jarvis'],
    tags: [],
    salience: 4,
    timestamp: ts,
  })

  db.upsertMemoryByMemId({
    mem_id: 'fact_screen_resolution_state',
    type: 'fact',
    title: 'Screen resolution state',
    content: 'The display has physical resolution 2880x1800 and logical resolution 1920x1200 under 150 percent scaling.',
    detail: 'This is useful background about the display state.',
    entities: ['agent:jarvis'],
    tags: ['domain:desktop_control'],
    salience: 5,
    timestamp: ts,
  })

  db.upsertMemoryByMemId({
    mem_id: 'procedure_web_research_sources',
    type: 'knowledge',
    title: 'Web research source discipline',
    content: 'When doing web research, always check primary sources and cite the exact source used.',
    detail: 'Use this for search and citation tasks.',
    entities: ['agent:jarvis'],
    tags: ['kind:procedure', 'domain:web_research', 'trigger:search', 'trigger:source', 'trigger:citation'],
    salience: 4,
    timestamp: ts,
  })

  const screenshotMsg = '[ID:000099] 2026-06-11T01:00:00+08:00 [TUI] Please make the Jarvis window fullscreen with F11, then take a screenshot and send it.'
  const screenshotInjection = await runInjector({ message: screenshotMsg, state: {} })
  const screenshotIds = new Set((screenshotInjection.activePolicies || []).map(m => m.mem_id))

  assert(screenshotIds.has('procedure_desktop_capture_dpi_aware'), 'tagged screenshot procedure activates for fullscreen screenshot task')
  assert(screenshotIds.has('knowledge_legacy_screenshot_method'), 'legacy untagged screenshot method activates from policy cues')
  assert(!screenshotIds.has('fact_screen_resolution_state'), 'plain fact is not promoted to active policy')
  assert(!screenshotIds.has('procedure_web_research_sources'), 'unrelated web policy does not activate for screenshot task')

  const activePolicyText = formatActivePoliciesForPrompt(screenshotInjection.activePolicies)
  assert(activePolicyText.includes('DPI-aware desktop capture'), 'formatter includes active policy title')

  const contextBlock = buildContextBlock({ activePolicies: activePolicyText, memories: '' })
  assert(contextBlock.includes('<active-policies>'), 'context block renders active-policies section')
  assert(!contextBlock.includes('<memories>'), 'active policies render independently from ordinary memories')

  db.insertConversation({
    role: 'user',
    from_id: 'ID:000099',
    content: 'Earlier we were talking about fullscreen screenshots and DPI scaling.',
    timestamp: '2026-06-11T01:02:00+08:00',
  })
  db.insertConversation({
    role: 'jarvis',
    from_id: 'jarvis',
    to_id: 'ID:000099',
    content: 'The screenshot workflow uses SetProcessDPIAware.',
    timestamp: '2026-06-11T01:03:00+08:00',
  })

  const searchMsg = '[ID:000099] 2026-06-11T01:05:00+08:00 [TUI] Please search the web for current docs and cite the sources.'
  const searchInjection = await runInjector({ message: searchMsg, state: {} })
  const searchIds = new Set((searchInjection.activePolicies || []).map(m => m.mem_id))
  assert(searchIds.has('procedure_web_research_sources'), 'web research procedure activates for search/source task')
  assert(!searchIds.has('procedure_desktop_capture_dpi_aware'), 'desktop screenshot procedure stays inactive for unrelated search task')
} catch (err) {
  failed++
  process.exitCode = 1
  console.error(`FAIL: unexpected error: ${err.stack || err.message}`)
} finally {
  try { fs.rmSync(tempUserDir, { recursive: true, force: true }) } catch {}
}

console.log(failed === 0 ? '\nAll active-policy tests passed' : `\n${failed} active-policy test(s) failed`)
process.exit(failed === 0 ? 0 : 1)
