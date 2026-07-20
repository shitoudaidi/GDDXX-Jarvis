const path = require('path')

const root = path.resolve(__dirname, '..')
process.env.JARVIS_USER_DIR = process.env.JARVIS_USER_DIR || path.join(root, 'runtime', 'jarvis')
process.env.JARVIS_RESOURCES_DIR = process.env.JARVIS_RESOURCES_DIR || root
process.env.JARVIS_HOME = process.env.JARVIS_HOME || root
process.env.GROK_HOME = process.env.GROK_HOME || path.join(root, 'runtime', 'grok-home')
process.env.JARVIS_GROK_BIN = process.env.JARVIS_GROK_BIN || path.join(root, 'tools', 'grok-cli', 'node_modules', '@xai-official', 'grok-win32-x64', 'bin', 'grok.exe')
process.env.JARVIS_GROK_TEMP = process.env.JARVIS_GROK_TEMP || path.join(root, 'runtime', 'tmp')
process.env.TEMP = process.env.JARVIS_GROK_TEMP
process.env.TMP = process.env.JARVIS_GROK_TEMP

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const bridge = await import('../src/core/grok-build.js')
  const installed = bridge.getGrokBuildStatus()
  if (!installed.available) throw new Error(`Grok Build binary missing: ${installed.binary}`)
  const task = bridge.startGrokBuildTask({
    cwd: root,
    prompt: 'Read package.json and report only the package name and version. Do not edit files and do not run shell commands.',
  })
  const deadline = Date.now() + 180_000
  let current = task
  while (Date.now() < deadline) {
    await sleep(500)
    current = bridge.getGrokBuildStatus().task
    if (current?.status === 'waiting_permission') {
      throw new Error(`Unexpected permission request during read-only probe: ${current.permission?.title || 'unknown'}`)
    }
    if (['completed', 'error', 'cancelled'].includes(current?.status)) break
  }
  if (current?.status !== 'completed') {
    try { bridge.cancelGrokBuildTask(current?.id) } catch {}
    throw new Error(`Grok Build probe did not complete: ${current?.status || 'timeout'} ${current?.error || ''}`)
  }
  if (!/gddxx-jarvis/i.test(current.output || '')) {
    throw new Error(`Grok Build output did not contain the package name: ${(current.output || '').slice(0, 500)}`)
  }
  let permissionProbe = null
  if (/^(1|true|yes)$/i.test(process.env.JARVIS_GROK_WRITE_PROBE || '')) {
    const fs = require('fs')
    const probeFile = path.join(root, 'runtime', 'jarvis', 'sandbox', 'grok-build-permission-probe.txt')
    try { fs.rmSync(probeFile, { force: true }) } catch {}
    const writeTask = bridge.startGrokBuildTask({
      cwd: path.dirname(probeFile),
      prompt: `Create the file ${probeFile} containing exactly JARVIS_GROK_PERMISSION_OK and then report completion.`,
    })
    const writeDeadline = Date.now() + 180_000
    let writeCurrent = writeTask
    let approved = false
    while (Date.now() < writeDeadline) {
      await sleep(400)
      writeCurrent = bridge.getGrokBuildStatus().task
      if (writeCurrent?.status === 'waiting_permission' && !approved) {
        bridge.answerGrokBuildPermission({ taskId: writeCurrent.id, decision: 'approve' })
        approved = true
      }
      if (['completed', 'error', 'cancelled'].includes(writeCurrent?.status)) break
    }
    const content = fs.existsSync(probeFile) ? fs.readFileSync(probeFile, 'utf8').trim() : ''
    try { fs.rmSync(probeFile, { force: true }) } catch {}
    if (writeCurrent?.status !== 'completed' || !approved || content !== 'JARVIS_GROK_PERMISSION_OK') {
      throw new Error(`Permission probe failed: status=${writeCurrent?.status} approved=${approved} content=${content} error=${writeCurrent?.error || ''}`)
    }
    permissionProbe = { status: writeCurrent.status, approved, content }
  }
  console.log(JSON.stringify({
    ok: true,
    status: current.status,
    model: current.model,
    cwd: current.cwd,
    output: current.output.trim().slice(0, 500),
    events: current.events.length,
    permissionProbe,
  }))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }))
  process.exitCode = 1
})
