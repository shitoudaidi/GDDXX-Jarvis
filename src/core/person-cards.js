import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { paths } from './paths.js'
import { upsertMemoryByMemId } from './db.js'
import { nowTimestamp } from './time.js'

const PERSON_CARD_CONTEXT_TTL_MINUTES = 60
const PERSON_CARD_STORE_FILE = path.join(paths.dataDir, 'person-cards.json')

const PERSON_CARD_LIBRARY = [
  {
    name: '周杰伦',
    aliases: ['Jay Chou', '杰伦'],
    title: '歌手 / 音乐人 / 导演',
    summary: '华语流行音乐代表人物之一，以融合 R&B、嘻哈、中国风和古典元素的作品闻名。',
    knownFor: ['七里香', '青花瓷', '稻香', '不能说的秘密'],
    tags: ['华语音乐', '创作歌手', '中国风'],
  },
  {
    name: '刘德华',
    aliases: ['Andy Lau', '华仔'],
    title: '演员 / 歌手 / 制片人',
    summary: '香港“四大天王”之一，长期活跃于电影、音乐和公益领域。',
    knownFor: ['无间道', '天若有情', '忘情水', '恭喜发财'],
    tags: ['香港电影', '粤语流行', '四大天王'],
  },
  {
    name: '成龙',
    aliases: ['Jackie Chan'],
    title: '演员 / 导演 / 动作指导',
    summary: '国际知名动作电影演员，以高难度动作喜剧和亲自完成特技著称。',
    knownFor: ['警察故事', '尖峰时刻', '醉拳', '十二生肖'],
    tags: ['动作电影', '功夫', '国际影星'],
  },
  {
    name: '周星驰',
    aliases: ['Stephen Chow', '星爷'],
    title: '演员 / 导演 / 编剧',
    summary: '香港喜剧电影代表人物，形成了辨识度很高的无厘头喜剧风格。',
    knownFor: ['大话西游', '功夫', '喜剧之王', '少林足球'],
    tags: ['香港电影', '喜剧', '导演'],
  },
  {
    name: '王一博',
    aliases: ['YiBo'],
    title: '演员 / 歌手 / 舞者',
    summary: '中国内地艺人，因影视、舞台、街舞和赛车相关活动受到关注。',
    knownFor: ['陈情令', '无名', '这就是街舞', '长空之王'],
    tags: ['演员', '舞者', '流量明星'],
  },
  {
    name: '肖战',
    aliases: ['Sean Xiao'],
    title: '演员 / 歌手',
    summary: '中国内地演员和歌手，因影视剧、音乐作品和舞台活动拥有较高讨论度。',
    knownFor: ['陈情令', '斗罗大陆', '玉骨遥', '光点'],
    tags: ['演员', '歌手', '流量明星'],
  },
  {
    name: '迪丽热巴',
    aliases: ['Dilraba', 'Dilireba'],
    title: '演员',
    summary: '中国内地女演员，出演多部古装、都市和偶像题材影视作品。',
    knownFor: ['三生三世十里桃花', '你是我的荣耀', '长歌行', '克拉恋人'],
    tags: ['演员', '影视明星'],
  },
  {
    name: '杨幂',
    aliases: ['Mini Yang'],
    title: '演员 / 制片人',
    summary: '中国内地女演员，长期活跃于电视剧、电影和艺人经纪领域。',
    knownFor: ['宫锁心玉', '三生三世十里桃花', '小时代', '仙剑奇侠传三'],
    tags: ['演员', '制片人'],
  },
  {
    name: '赵丽颖',
    aliases: ['Zanilia Zhao'],
    title: '演员',
    summary: '中国内地女演员，以多部古装、现实题材电视剧获得广泛关注。',
    knownFor: ['花千骨', '知否知否应是绿肥红瘦', '楚乔传', '风吹半夏'],
    tags: ['演员', '电视剧'],
  },
  {
    name: '易烊千玺',
    aliases: ['Jackson Yee'],
    title: '演员 / 歌手 / 舞者',
    summary: 'TFBOYS 成员之一，后来在电影表演和个人音乐舞台上持续发展。',
    knownFor: ['少年的你', '长津湖', '奇迹·笨小孩', 'TFBOYS'],
    tags: ['演员', '歌手', '青年演员'],
  },
  {
    name: '蔡徐坤',
    aliases: ['KUN'],
    title: '歌手 / 舞者 / 音乐制作人',
    summary: '中国内地流行歌手和舞者，因偶像选秀、音乐舞台和综艺节目获得高关注。',
    knownFor: ['偶像练习生', 'Wait Wait Wait', '情人', '青春有你'],
    tags: ['歌手', '偶像', '舞台'],
  },
  {
    name: '邓紫棋',
    aliases: ['G.E.M.', 'GEM'],
    title: '歌手 / 词曲作者',
    summary: '华语流行女歌手，以高辨识度唱腔、创作能力和现场演唱实力闻名。',
    knownFor: ['泡沫', '光年之外', '句号', '我是歌手'],
    tags: ['华语音乐', '创作歌手'],
  },
  {
    name: 'Taylor Swift',
    aliases: ['泰勒斯威夫特', '泰勒·斯威夫特', '霉霉'],
    title: 'Singer-songwriter',
    summary: '美国创作歌手，长期以流行、乡村和叙事型歌词作品影响全球流行文化。',
    knownFor: ['Love Story', 'Blank Space', 'Shake It Off', 'Eras Tour'],
    tags: ['欧美音乐', '创作歌手', '流行文化'],
  },
]

let panelActiveUntilMs = 0
let panelState = {
  active: false,
  updatedAtMs: 0,
  source: 'startup',
  card: null,
}
let cardStore = null

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '')
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,，、;；\n]/).map(v => v.trim()).filter(Boolean)
  return []
}

function personCardId(name = '') {
  const normalized = normalizeText(name).slice(0, 80) || String(name || 'unknown')
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12)
  return `person_card_${hash}`
}

function loadCardStore() {
  if (cardStore) return cardStore
  try {
    const parsed = JSON.parse(fs.readFileSync(PERSON_CARD_STORE_FILE, 'utf-8'))
    cardStore = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cardStore = {}
  }
  return cardStore
}

function writeCardStore() {
  try {
    fs.mkdirSync(path.dirname(PERSON_CARD_STORE_FILE), { recursive: true })
    fs.writeFileSync(PERSON_CARD_STORE_FILE, JSON.stringify(loadCardStore(), null, 2), 'utf-8')
  } catch (err) {
    console.warn('[PersonCard] 人物卡片落盘失败:', err.message)
  }
}

function hasUsefulCardData(card = {}) {
  const knownFor = normalizeList(card.knownFor ?? card.works)
  const tags = normalizeList(card.tags)
  const summary = String(card.summary || '').trim()
  const title = String(card.title || card.identity || card.role || '').trim()
  const image = String(card.image || card.photo || card.avatar || '').trim()
  return Boolean(
    image ||
    knownFor.length ||
    tags.some(tag => tag && tag !== '待补充' && tag !== 'standby') ||
    (summary && !summary.includes('暂时没有') && !summary.includes('暂无简介')) ||
    (title && title !== '人物卡片' && title !== '待命')
  )
}

function storedKeysForCard(card = {}) {
  const names = [card.name, ...(normalizeList(card.aliases))]
  return [...new Set(names.map(normalizeText).filter(Boolean))]
}

function mergeCardData(existing = {}, incoming = {}) {
  const merged = normalizeCard({
    ...existing,
    ...incoming,
    aliases: [...new Set([...normalizeList(existing.aliases), ...normalizeList(incoming.aliases)])],
    knownFor: [...new Set([...normalizeList(existing.knownFor), ...normalizeList(incoming.knownFor ?? incoming.works)])],
    tags: [...new Set([...normalizeList(existing.tags), ...normalizeList(incoming.tags)])],
    image: incoming.image || incoming.photo || incoming.avatar || existing.image || existing.photo || existing.avatar || '',
    avatar: incoming.avatar || incoming.image || incoming.photo || existing.avatar || existing.image || existing.photo || '',
    source: incoming.source && incoming.source !== 'fallback' ? incoming.source : (existing.source || incoming.source || 'saved'),
    updatedAt: new Date().toISOString(),
  })
  return merged
}

function savePersonCard(card = {}) {
  if (!card?.name || !hasUsefulCardData(card)) return null
  const store = loadCardStore()
  const primaryKey = normalizeText(card.name)
  const existing = store[primaryKey] || null
  const saved = mergeCardData(existing || {}, { ...card, source: card.source || 'saved' })
  for (const key of storedKeysForCard(saved)) {
    store[key] = saved
  }
  writeCardStore()
  return saved
}

function baseCardFromName(name = '') {
  const normalizedName = String(name || '').trim() || '未知人物'
  return {
    id: personCardId(normalizedName),
    name: normalizedName,
    aliases: [],
    title: '人物卡片',
    summary: '暂时没有内置资料。可以让 Longma 补充身份、代表作品和为什么被提到。',
    knownFor: [],
    tags: ['待补充'],
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  }
}

function normalizeCard(card = {}) {
  const name = String(card.name || card.person || card.title || '').trim()
  const base = baseCardFromName(name)
  return {
    ...base,
    ...card,
    id: card.id || base.id || personCardId(name),
    name: name || base.name,
    aliases: normalizeList(card.aliases ?? base.aliases),
    knownFor: normalizeList(card.knownFor ?? card.works ?? base.knownFor),
    tags: normalizeList(card.tags ?? base.tags),
    summary: String(card.summary || base.summary || '').trim(),
    title: String(card.title || card.identity || card.role || base.title || '人物卡片').trim(),
    image: String(card.image || card.photo || card.avatar || base.image || base.avatar || '').trim(),
    avatar: String(card.avatar || card.image || card.photo || base.avatar || base.image || '').trim(),
    source: String(card.source || base.source || 'agent').trim(),
    updatedAt: card.updatedAt || new Date().toISOString(),
  }
}

export function findPersonCard(query = '') {
  const normalized = normalizeText(query)
  if (!normalized) return null
  const store = loadCardStore()
  const saved = store[normalized]
  if (saved) return normalizeCard({ ...saved, source: saved.source || 'saved' })

  for (const card of PERSON_CARD_LIBRARY) {
    const names = [card.name, ...(card.aliases || [])]
    if (names.some(name => normalizeText(name) === normalized)) {
      return normalizeCard({ ...card, source: 'builtin' })
    }
  }
  for (const card of PERSON_CARD_LIBRARY) {
    const names = [card.name, ...(card.aliases || [])]
    if (names.some(name => normalizeText(name).includes(normalized) || normalized.includes(normalizeText(name)))) {
      return normalizeCard({ ...card, source: 'builtin' })
    }
  }

  for (const card of Object.values(store)) {
    const names = [card.name, ...(card.aliases || [])]
    if (names.some(name => normalizeText(name).includes(normalized) || normalized.includes(normalizeText(name)))) {
      return normalizeCard({ ...card, source: card.source || 'saved' })
    }
  }
  return null
}

export function setPersonCardPanelState({ active, source = 'unknown', card = null, name = '' } = {}) {
  const nextActive = typeof active === 'boolean' ? active : panelState.active
  const nextCard = card
    ? normalizeCard(card)
    : (name ? (findPersonCard(name) || baseCardFromName(name)) : panelState.card)
  const persistedCard = nextCard ? savePersonCard(nextCard) : null

  panelState = {
    active: nextActive,
    updatedAtMs: Date.now(),
    source,
    card: persistedCard || nextCard,
  }
  if (nextActive) panelActiveUntilMs = Date.now() + PERSON_CARD_CONTEXT_TTL_MINUTES * 60 * 1000
  return getPersonCardPanelState()
}

export function getPersonCardPanelState() {
  const now = Date.now()
  return {
    ...panelState,
    updatedAt: panelState.updatedAtMs ? new Date(panelState.updatedAtMs).toISOString() : null,
    contextActive: now < panelActiveUntilMs,
    contextTtlSeconds: Math.max(0, Math.round((panelActiveUntilMs - now) / 1000)),
  }
}

export function getPersonCard(query = '') {
  return findPersonCard(query) || baseCardFromName(query)
}

export function buildPersonCardPanelStateContext() {
  const state = getPersonCardPanelState()
  const status = state.active ? 'open' : 'closed'
  const ttl = state.contextActive ? `Person-card context TTL has about ${Math.ceil(state.contextTtlSeconds / 60)} minutes remaining` : 'No active person-card context TTL'
  const current = state.card?.name ? `Current person: ${state.card.name}.` : 'No person is selected.'
  return `## Person Card State
Current person-card panel: ${status}. ${current}${ttl}.
Use the person_card_mode tool to open, update, or close a person card only when the user explicitly says they do not know someone, asks who someone is, or a demo requires it. Do not open it proactively just to show off.`
}

function persistMentionedPerson(card, message = '') {
  if (!card?.name) return null
  const timestamp = nowTimestamp()
  const memId = `known_person_${personCardId(card.name).replace(/^person_card_/, '')}`
  const detail = [
    `Identity: ${card.title || 'unknown'}`,
    `Summary: ${card.summary || ''}`,
    card.knownFor?.length ? `Known for: ${card.knownFor.join(', ')}` : '',
    card.tags?.length ? `Tags: ${card.tags.join(', ')}` : '',
    `Source: ${card.source || 'person_card'}`,
    `Trigger message excerpt: ${String(message || '').slice(0, 120)}`,
    'This is an automatically archived person-identification fact. If more accurate information appears later, update the same mem_id with upsert_memory.',
  ].filter(Boolean).join('\n')

  return upsertMemoryByMemId({
    mem_id: memId,
    type: 'person_card',
    title: `Person card: ${card.name}`,
    content: `The user asked about or mentioned this person: ${card.name}`,
    detail,
    entities: ['SYSTEM'],
    concepts: [card.name, ...(card.aliases || []), ...(card.tags || [])].filter(Boolean).slice(0, 16),
    tags: ['person_card', 'public_figure', `source:${card.source || 'unknown'}`],
    source_ref: 'person_card_context',
    timestamp,
  })
}

export function buildPersonCardRuntimeContext() {
  const state = getPersonCardPanelState()
  const card = state.contextActive ? state.card : null
  if (!card?.name) return ''

  return `## Person Card Context
Source: person-card mode, triggered by the agent. Sender: SYSTEM. Purpose: help explain public figures the user may not know; this does not mean the user created a separate new task.

Current person: ${card.name}
Identity: ${card.title || 'unknown'}
Summary: ${card.summary || 'none'}
Known for: ${card.knownFor?.length ? card.knownFor.join(', ') : 'none'}
Tags: ${card.tags?.length ? card.tags.join(', ') : 'none'}
Source: ${card.source || 'person_card'}

Usage rule: explain proactively only when the user explicitly asks who someone is, says they do not know someone, or the person is directly related to the current topic. Keep the explanation concise and avoid inventing uncertain biographical details.`
}
