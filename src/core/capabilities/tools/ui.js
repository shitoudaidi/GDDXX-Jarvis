import crypto from 'crypto'
import { emitEvent, emitUICommand, hasACUIClient, addActiveUICard, removeActiveUICard, getActiveUICards } from '../../events.js'

const COMPONENT_DEFINITIONS = Object.freeze({
  WeatherCard: {
    city: 'string', temp: 'number', condition: 'string', desc: 'string', feel: 'number',
    high: 'number', low: 'number', wind: 'string', forecast: 'array',
  },
  SelfCheckCard: { results: 'array!', overall: 'string' },
  SelfCheckStepCard: { step: 'number!', total: 'number', name: 'string!' },
  AwakeningCard: { index: 'number!', total: 'number', title: 'string!', finding: 'string' },
})

const VALUE_LIMITS = Object.freeze({ string: 800, array: 12, keys: 32, depth: 4 })

function sanitizeValue(value, depth = 0) {
  if (depth > VALUE_LIMITS.depth) return '[nested data]'
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return value.slice(0, VALUE_LIMITS.string)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, VALUE_LIMITS.array).map(item => sanitizeValue(item, depth + 1))
  if (typeof value !== 'object') return String(value).slice(0, VALUE_LIMITS.string)
  return Object.fromEntries(
    Object.entries(value).slice(0, VALUE_LIMITS.keys).map(([key, item]) => [
      String(key).slice(0, 80),
      sanitizeValue(item, depth + 1),
    ]),
  )
}

function coerceAndValidate(component, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { error: 'props must be an object' }
  }
  const definition = COMPONENT_DEFINITIONS[component]
  if (!definition) return { error: `unsupported component: ${component}` }
  const props = sanitizeValue(source)
  for (const [name, rawType] of Object.entries(definition)) {
    const required = rawType.endsWith('!')
    const type = required ? rawType.slice(0, -1) : rawType
    let value = props[name]
    if (required && (value === undefined || value === null || value === '')) {
      return { error: `missing required prop: ${name}` }
    }
    if (value === undefined || value === null) continue
    if (type === 'number' && typeof value !== 'number') {
      if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        value = Number(value)
        props[name] = value
      } else {
        return { error: `prop ${name} must be a number` }
      }
    }
    if (type === 'string' && typeof value !== 'string') return { error: `prop ${name} must be a string` }
    if (type === 'array' && !Array.isArray(value)) return { error: `prop ${name} must be an array` }
  }
  return { props }
}

function resultError(error) {
  return JSON.stringify({ ok: false, error })
}

export function persistAppState() {
  // Executable model-generated apps were retired with the legacy interface.
  return false
}

export function execUIShow({ component, props } = {}) {
  if (!component) return resultError('component is required')
  if (!hasACUIClient()) return resultError('the Jarvis workbench is not connected')
  const checked = coerceAndValidate(component, props || {})
  if (checked.error) return resultError(checked.error)

  if (component === 'SelfCheckStepCard') {
    for (const card of getActiveUICards().filter(item => item.component === component)) {
      emitUICommand({ op: 'unmount', id: card.id })
      removeActiveUICard(card.id)
    }
  }

  const id = `${component.toLowerCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  emitUICommand({ op: 'mount', id, component, props: checked.props })
  addActiveUICard(id, { component })
  emitEvent('action', { tool: 'ui_show', summary: `show ${component}`, detail: id })
  return JSON.stringify({ ok: true, id, component })
}

export function execUIHide({ id } = {}) {
  if (!id) return resultError('id is required')
  const card = getActiveUICards().find(item => item.id === id)
  if (!card) return resultError(`card not found: ${id}`)
  if (!hasACUIClient()) return resultError('the Jarvis workbench is not connected')
  emitUICommand({ op: 'unmount', id })
  removeActiveUICard(id)
  emitEvent('action', { tool: 'ui_hide', summary: 'close result', detail: id })
  return JSON.stringify({ ok: true, id })
}

export function execUIUpdate({ id, props } = {}) {
  if (!id) return resultError('id is required')
  const card = getActiveUICards().find(item => item.id === id)
  if (!card) return resultError(`card not found: ${id}`)
  if (!props || typeof props !== 'object' || Array.isArray(props)) return resultError('props must be an object')
  if (!hasACUIClient()) return resultError('the Jarvis workbench is not connected')
  const sanitized = sanitizeValue(props)
  emitUICommand({ op: 'update', id, props: sanitized })
  emitEvent('action', { tool: 'ui_update', summary: 'update result', detail: id })
  return JSON.stringify({ ok: true, id })
}

export function execUIPatch({ id, op, data } = {}) {
  if (!id) return resultError('id is required')
  if (!['merge', 'replace', 'append'].includes(op)) return resultError('op must be merge, replace, or append')
  if (!data || typeof data !== 'object' || Array.isArray(data)) return resultError('data must be an object')
  if (!getActiveUICards().some(item => item.id === id)) return resultError(`card not found: ${id}`)
  if (!hasACUIClient()) return resultError('the Jarvis workbench is not connected')
  emitUICommand({ op: 'patch', id, patchOp: op, data: sanitizeValue(data) })
  emitEvent('action', { tool: 'ui_patch', summary: `patch result: ${op}`, detail: id })
  return JSON.stringify({ ok: true, id, op })
}
