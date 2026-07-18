import crypto from 'crypto'
import {
  getEmbeddingCredentials,
  LOCAL_EMBEDDING_DIMS,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_PROVIDER,
} from './config.js'

const MAX_CACHE_ENTRIES = 200
const MIN_TEXT_LENGTH = 2

const cache = new Map()

function cacheKey(text, cred) {
  return crypto
    .createHash('sha256')
    .update([
      cred?.provider || LOCAL_EMBEDDING_PROVIDER,
      cred?.model || LOCAL_EMBEDDING_MODEL,
      String(cred?.dimensions || LOCAL_EMBEDDING_DIMS),
      text,
    ].join('\x01'))
    .digest('hex')
}

function cacheGet(key) {
  if (!cache.has(key)) return null
  const value = cache.get(key)
  cache.delete(key)
  cache.set(key, value)
  return value
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

export function clearEmbeddingCache() {
  cache.clear()
}

function isLocalCredential(cred) {
  return (
    cred?.provider === LOCAL_EMBEDDING_PROVIDER ||
    cred?.localFallback ||
    !cred?.apiKey ||
    !cred?.model
  )
}

export function isEmbeddingConfigured() {
  try {
    const cred = getEmbeddingCredentials()
    return !!(cred && cred.model && (isLocalCredential(cred) || cred.apiKey))
  } catch {
    return false
  }
}

function f32ArrayToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

function fnv1a(text, seed = 0x811c9dc5) {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function isCjkCodePoint(code) {
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function normalizeEmbeddingText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeLocal(text) {
  const normalized = normalizeEmbeddingText(text)
  if (!normalized) return []

  const features = []
  const words = normalized.match(/[a-z0-9_]+/g) || []
  for (const word of words) {
    features.push(`w:${word}`)
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 3; i++) {
        features.push(`wg:${word.slice(i, i + 3)}`)
      }
    }
  }

  const compactChars = Array.from(normalized.replace(/\s+/g, ''))
  for (const ch of compactChars) {
    const code = ch.codePointAt(0)
    if (Number.isFinite(code) && isCjkCodePoint(code)) {
      features.push(`c:${ch}`)
    }
  }

  for (const n of [2, 3, 4]) {
    if (compactChars.length < n) continue
    for (let i = 0; i <= compactChars.length - n; i++) {
      features.push(`s${n}:${compactChars.slice(i, i + n).join('')}`)
    }
  }

  if (!features.length) {
    features.push(`raw:${normalized.slice(0, 64)}`)
  }
  return features.slice(0, 2400)
}

function addLocalFeature(vec, feature, weight) {
  const h1 = fnv1a(feature)
  const i1 = h1 % vec.length
  vec[i1] += (h1 & 0x80000000 ? -1 : 1) * weight

  const h2 = fnv1a(`mix:${feature}`, h1)
  const i2 = h2 % vec.length
  vec[i2] += (h2 & 1 ? -0.45 : 0.45) * weight
}

function computeLocalEmbedding(text, dimensions = LOCAL_EMBEDDING_DIMS) {
  const dim = Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : LOCAL_EMBEDDING_DIMS
  const features = tokenizeLocal(text)
  if (!features.length) return null

  const vec = new Float32Array(dim)
  const baseWeight = 1 / Math.sqrt(features.length)
  for (const feature of features) {
    addLocalFeature(vec, feature, baseWeight)
  }

  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (!Number.isFinite(norm) || norm <= 0) return null

  for (let i = 0; i < vec.length; i++) vec[i] /= norm
  return f32ArrayToBuffer(vec)
}

async function computeRemoteEmbedding(input, cred) {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({
    apiKey: cred.apiKey,
    baseURL: cred.baseURL || undefined,
    timeout: 15000,
  })

  const params = { model: cred.model, input }
  if (cred.provider === 'openai' && Number.isFinite(cred.dimensions) && cred.dimensions > 0) {
    params.dimensions = cred.dimensions
  }

  const resp = await client.embeddings.create(params)
  const vec = resp?.data?.[0]?.embedding
  if (!Array.isArray(vec) || vec.length === 0) return null

  const f32 = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) f32[i] = Number(vec[i]) || 0
  return f32ArrayToBuffer(f32)
}

export async function computeEmbedding(text) {
  const input = typeof text === 'string' ? text.trim() : ''
  if (!input || input.length < MIN_TEXT_LENGTH) return null

  let cred
  try {
    cred = getEmbeddingCredentials()
  } catch {
    return null
  }
  if (!cred || !cred.model) return null

  const key = cacheKey(input, cred)
  const cached = cacheGet(key)
  if (cached) return cached

  let buf = null
  if (isLocalCredential(cred)) {
    buf = computeLocalEmbedding(input, cred.dimensions || LOCAL_EMBEDDING_DIMS)
  } else {
    try {
      buf = await computeRemoteEmbedding(input, cred)
    } catch {
      return null
    }
  }

  if (buf) cacheSet(key, buf)
  return buf
}
