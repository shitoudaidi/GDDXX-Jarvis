const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const retired = [
  'media_mode',
  'generate_video',
  'hotspot_mode',
  'worldcup_mode',
  'open_doc_panel',
  'person_card_mode',
  'manage_app',
  'ui_register',
  'focus_banner',
]

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function add(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
}

;(async () => {
  const [{ TOOL_SCHEMAS }, { selectTools }, events, uiTools] = await Promise.all([
    import('../src/core/capabilities/schemas.js'),
    import('../src/core/memory/tool-router.js'),
    import('../src/core/events.js'),
    import('../src/core/capabilities/tools/ui.js'),
  ])
  const checks = []
  const schemaNames = Object.keys(TOOL_SCHEMAS)
  const uiNames = schemaNames.filter(name => name.startsWith('ui_')).sort()
  const expectedUi = ['ui_hide', 'ui_patch', 'ui_show', 'ui_update']
  add(checks, 'only current data-only UI tools are cataloged',
    JSON.stringify(uiNames) === JSON.stringify(expectedUi), uiNames.join(', '))

  const leakedSchemas = retired.filter(name => TOOL_SCHEMAS[name])
  add(checks, 'retired desktop tools are absent from the model catalog', leakedSchemas.length === 0, leakedSchemas.join(', '))

  const scenarios = [
    selectTools({ messageBody: '打开热点面板看新闻', senderId: 'ID:probe' }),
    selectTools({ messageBody: '进入专注模式完成任务', senderId: 'ID:probe', hasTask: true }),
    selectTools({ messageBody: '马云是谁', senderId: 'ID:probe' }),
    selectTools({ messageBody: '播放一段视频', senderId: 'ID:probe' }),
    selectTools({ messageBody: '', isTick: true, startupSelfCheckActive: true }),
  ]
  const exposedRetired = [...new Set(scenarios.flat().filter(name => retired.includes(name)))]
  add(checks, 'tool selection never exposes retired desktop tools', exposedRetired.length === 0, exposedRetired.join(', '))

  const components = JSON.parse(read('src/core/capabilities/ui-components.json'))
  const componentNames = Object.keys(components).sort()
  const expectedComponents = ['AwakeningCard', 'SelfCheckCard', 'SelfCheckStepCard', 'WeatherCard']
  add(checks, 'result component registry matches the current workbench',
    JSON.stringify(componentNames) === JSON.stringify(expectedComponents), componentNames.join(', '))

  const selfKnowledge = read('src/core/docs/self-knowledge.js')
  add(checks, 'self knowledge describes the current Jarvis workbench',
    /src\/ui\/jarvis-react/.test(selfKnowledge)
      && /安全实时结果/.test(selfKnowledge)
      && !/Brain UI 总览|src\/ui\/brain-ui|ui_register 转正|Focus Banner 专注横幅/.test(selfKnowledge))

  const uiTool = read('src/core/capabilities/tools/ui.js')
  add(checks, 'UI executor is data-only and has no legacy source paths',
    /COMPONENT_DEFINITIONS/.test(uiTool)
      && /sanitizeValue/.test(uiTool)
      && !/brain-ui|new Function|inline-script|customElements|execUIRegister|execManageApp/.test(uiTool))

  const prompt = read('src/core/prompt.js')
  add(checks, 'prompt does not command retired panels',
    /The retired desktop focus banner is not available/.test(prompt)
      && /does not embed or autoplay arbitrary videos/.test(prompt)
      && !/Call media_mode with mode="music"|must immediately call focus_banner/.test(prompt))

  const docs = read('src/core/docs.js')
  add(checks, 'documentation is injected into chat without a panel tool',
    /answer directly in chat/.test(docs)
      && !/immediately call open_doc_panel|Before any text reply.*open_doc_panel/.test(docs))

  const legacyDir = path.join(root, 'src', 'core', 'ui', 'brain-ui')
  const legacyCode = fs.existsSync(legacyDir)
    ? fs.readdirSync(legacyDir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(?:js|css|html|md)$/i.test(entry.name))
      .map(entry => entry.name)
    : []
  add(checks, 'legacy interface code files are physically removed', legacyCode.length === 0, legacyCode.join(', '))

  const frames = []
  const fakeClient = { send(value) { frames.push(JSON.parse(value)) } }
  events.addACUIClient(fakeClient)
  const shown = JSON.parse(uiTools.execUIShow({
    component: 'WeatherCard',
    props: { city: 'Shanghai', temp: '29', condition: 'Cloudy' },
  }))
  const mounted = frames.find(frame => frame.op === 'mount' && frame.id === shown.id)
  add(checks, 'UI executor validates and mounts supported structured data',
    shown.ok === true && mounted?.component === 'WeatherCard' && mounted?.props?.temp === 29)

  const unsupported = JSON.parse(uiTools.execUIShow({ component: 'InlineScript', props: {} }))
  const missingRequired = JSON.parse(uiTools.execUIShow({ component: 'SelfCheckStepCard', props: { step: 1 } }))
  add(checks, 'UI executor rejects unsupported and incomplete cards',
    unsupported.ok === false && missingRequired.ok === false,
    `${unsupported.error || ''}; ${missingRequired.error || ''}`)

  const updated = JSON.parse(uiTools.execUIUpdate({ id: shown.id, props: { desc: 'x'.repeat(1200) } }))
  const updateFrame = [...frames].reverse().find(frame => frame.op === 'update' && frame.id === shown.id)
  add(checks, 'UI updates cap untrusted text length', updated.ok === true && updateFrame?.props?.desc?.length === 800)

  const patched = JSON.parse(uiTools.execUIPatch({ id: shown.id, op: 'merge', data: { wind: 'SE 3' } }))
  const invalidPatch = JSON.parse(uiTools.execUIPatch({ id: shown.id, op: 'execute', data: {} }))
  add(checks, 'UI patches allow data operations only', patched.ok === true && invalidPatch.ok === false)

  const hidden = JSON.parse(uiTools.execUIHide({ id: shown.id }))
  add(checks, 'UI hide removes server-side active state',
    hidden.ok === true && !events.getActiveUICards().some(card => card.id === shown.id))
  events.removeACUIClient(fakeClient)

  const result = { ok: checks.every(check => check.ok), checks }
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
})().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2))
  process.exit(1)
})
