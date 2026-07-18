import { startDiscordConnector } from './discord.js'
import { startClawbotConnector } from './wechat-clawbot.js'

const running = new Map()

function socialDisabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_DISABLE_SOCIAL || process.env.JARVIS_DISABLE_SOCIAL || '').trim())
}

export async function startSocialConnectors({ pushMessage, emitEvent } = {}) {
  if (socialDisabled()) {
    emitEvent?.('social_status', { platform: 'all', status: 'disabled' })
    return []
  }

  const starters = [
    { platform: 'discord', start: () => startDiscordConnector({ pushMessage, emitEvent }) },
    { platform: 'wechat-clawbot', start: () => startClawbotConnector({ pushMessage, emitEvent }) },
  ]

  for (const { platform, start } of starters) {
    try {
      const connector = await start()
      if (connector) {
        running.set(platform, connector)
        emitEvent?.('social_status', { platform, status: 'started' })
      }
    } catch (error) {
      console.error(`[social] ${platform} connector failed to start: ${error.message}`)
      emitEvent?.('social_status', { status: 'start_error', platform, error: error.message })
    }
  }

  return [...running.values()]
}

export async function restartConnector(platform, { pushMessage, emitEvent } = {}) {
  const existing = running.get(platform)
  if (existing) {
    try { existing.stop() } catch {}
    running.delete(platform)
  }

  if (socialDisabled()) {
    emitEvent?.('social_status', { platform, status: 'disabled' })
    return
  }

  const starters = {
    discord: () => startDiscordConnector({ pushMessage, emitEvent }),
    'wechat-clawbot': () => startClawbotConnector({ pushMessage, emitEvent }),
  }

  const start = starters[platform]
  if (!start) return

  try {
    const connector = await start()
    if (connector) {
      running.set(platform, connector)
      emitEvent?.('social_status', { platform, status: 'restarted' })
    }
  } catch (error) {
    console.error(`[social] ${platform} restart failed: ${error.message}`)
    emitEvent?.('social_status', { status: 'start_error', platform, error: error.message })
  }
}
