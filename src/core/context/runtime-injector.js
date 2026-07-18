import { gatherContext, formatExtraContext } from './gatherer.js'
import { buildKeywordRuntimeContext } from './keyword-context.js'
import { buildHotspotRuntimeContext, buildHotspotPanelStateContext } from '../hotspots.js'
import { buildWorldcupRuntimeContext, buildWorldcupPanelStateContext } from '../worldcup.js'
import { buildPersonCardRuntimeContext, buildPersonCardPanelStateContext } from '../person-cards.js'
import { buildWeatherRuntimeContext, getWeatherCardProps } from '../weather.js'
import { buildDocRuntimeContext, buildDocPanelStateContext, detectDocTopic } from '../docs.js'

export async function runRuntimeInjector({
  message = '',
  task = null,
  taskKnowledge = '',
  memories = '',
  fastUserPath = false,
  signal = null,
} = {}) {
  const text = String(message || '')

  // 同步派生（无 await，无 IO，直接算）—— 放最前面让后面的 await 期间这些已就绪
  const hotspotStateText = buildHotspotPanelStateContext()
  const hotspotContextText = buildHotspotRuntimeContext(text)
  const worldcupStateText = buildWorldcupPanelStateContext()
  const worldcupContextText = buildWorldcupRuntimeContext(text)
  const personCardStateText = buildPersonCardPanelStateContext()
  const personCardContextText = buildPersonCardRuntimeContext(text)
  const detectedDocTopic = detectDocTopic(text)
  const docStateText = buildDocPanelStateContext(detectedDocTopic)
  const docContextText = buildDocRuntimeContext(text)

  // Wave 1 优化：异步 await 全部并发跑。
  //   原实现 6 个 await 串行 = 累加耗时；改 Promise.all 后 = max(各自耗时)。
  //   weather 两个函数共享 isWeatherQuery gate + fetchAndCacheWeather 缓存，
  //     非 weather 消息瞬返 null；weather 消息只触发一次实际抓取。
  //   gatherContext 仍然只在 task && !fastUserPath 时跑（Wave 3 会换启发式）。
  const gatherContextPromise = (task && !fastUserPath)
    ? gatherContext({ task, taskKnowledge, memories, message: text, signal })
    : Promise.resolve([])

  const [
    keywordContextText,
    weatherContextText,
    weatherCardPropsRaw,
    taskExtraContextItemsRaw,
  ] = await Promise.all([
    buildKeywordRuntimeContext(text),
    buildWeatherRuntimeContext(text),
    getWeatherCardProps(text),
    gatherContextPromise,
  ])

  // weather card 仅在 weatherContextText 命中时才挂出（保持原语义）
  const weatherCardProps = weatherContextText ? weatherCardPropsRaw : null

  const taskExtraContextItems = taskExtraContextItemsRaw || []
  const taskExtraContextText = taskExtraContextItems.length
    ? formatExtraContext(taskExtraContextItems)
    : ''

  const contextParts = [
    keywordContextText,
    hotspotStateText,
    hotspotContextText,
    worldcupStateText,
    worldcupContextText,
    personCardStateText,
    personCardContextText,
    weatherContextText,
    docStateText,
    docContextText,
    taskExtraContextText,
  ].filter(Boolean)

  return {
    keywordContextText,
    hotspotStateText,
    hotspotContextText,
    worldcupStateText,
    worldcupContextText,
    personCardStateText,
    personCardContextText,
    weatherContextText,
    weatherCardProps,
    detectedDocTopic,
    docStateText,
    docContextText,
    taskExtraContextText,
    taskExtraContextItems,
    contextText: contextParts.join('\n\n'),
  }
}
