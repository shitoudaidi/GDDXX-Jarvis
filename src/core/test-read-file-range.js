import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execReadFile } from './capabilities/tools/filesystem.js'
import { TOOL_SCHEMAS } from './capabilities/schemas.js'

const target = path.join('sandbox', 'unit-read-range.txt')
const content = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].join('\n')

fs.writeFileSync(target, content, 'utf8')

try {
  const full = await execReadFile({ path: 'unit-read-range.txt' })
  assert.equal(full, content)

  const firstTwo = JSON.parse(await execReadFile({ path: 'unit-read-range.txt', max_lines: 2 }))
  assert.equal(firstTwo.ok, true)
  assert.equal(firstTwo.start_line, 1)
  assert.equal(firstTwo.end_line, 2)
  assert.equal(firstTwo.total_lines, 5)
  assert.equal(firstTwo.truncated, true)
  assert.equal(firstTwo.content, 'alpha\nbravo')

  const middle = JSON.parse(await execReadFile({ path: 'unit-read-range.txt', start_line: 2, end_line: 4 }))
  assert.equal(middle.start_line, 2)
  assert.equal(middle.end_line, 4)
  assert.equal(middle.content, 'bravo\ncharlie\ndelta')

  const zero = JSON.parse(await execReadFile({ path: 'unit-read-range.txt', max_lines: 0 }))
  assert.equal(zero.content, '')
  assert.equal(zero.end_line, 0)

  const props = TOOL_SCHEMAS.read_file.function.parameters.properties
  assert.ok(props.start_line)
  assert.ok(props.end_line)
  assert.ok(props.max_lines)

  console.log('test-read-file-range passed')
} finally {
  fs.rmSync(target, { force: true })
}
