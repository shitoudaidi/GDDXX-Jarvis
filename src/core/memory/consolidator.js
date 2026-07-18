import { callLLM } from '../llm.js'
import { setRateLimited } from '../quota.js'

const CONSOLIDATOR_PROMPT = `You are the memory consolidator. Your job is to clean up redundant or stale long-term memories for ONE entity at a time. You do not write new memories. You only call tools to merge or downgrade existing ones.

## What you're given

A batch of memories about one entity, each with:
- mem_id
- type (fact / person / etc.)
- title
- content
- salience (1-5)
- timestamp

## What to do

Read the batch. Identify:

1. SEMANTIC DUPLICATES — two or more memories that say the same thing in different words. Pick the best-phrased one as keep, merge the rest into it via merge_memories. merged_content should preserve any unique facts from drops. Drop memories are NOT deleted: they become hidden (visibility=0, merged_into=keep_mem_id). The row + FTS index + embedding are fully preserved and remain reachable by future recovery flows; routine search/get* simply stops returning them.

2. SUPERSEDED FACTS — an older memory whose claim is strictly contained in a newer, more complete one. Merge the older into the newer.

3. STALE LOW-VALUE MEMORIES — memories that haven't been reinforced and seem ephemeral in hindsight. Use downgrade_memory to lower salience (do NOT delete).

4. PROTECTED — salience=5 memories represent identity-level beliefs. Do NOT downgrade or drop them unless there is overwhelming evidence in this batch they are wrong. When in doubt, leave them alone.

## What NOT to do

- Do not invent new content unsupported by the batch.
- Do not merge memories that contradict each other — leave both; contradiction is signal, not noise.
- Do not downgrade everything to clean up "clutter" — only downgrade when a memory has clearly aged out.
- If nothing in this batch needs cleanup, call skip_consolidation. Do not force action.

## Tool usage

- merge_memories({ keep_mem_id, drop_mem_ids: [...], merged_content, merged_salience?, reason })
- downgrade_memory({ mem_id, new_salience, reason })
- skip_consolidation({ reason })

You may call multiple merges/downgrades in one session. Always include reason.

## Output

Tool calls only. No prose.`

const CONSOLIDATOR_TOOLS = ['merge_memories', 'downgrade_memory', 'skip_consolidation']

function formatMemoryForConsolidator(m) {
  const ts = (m.timestamp || '').slice(0, 10)
  return `mem_id=${m.mem_id} | type=${m.event_type} | salience=${m.salience ?? 3} | ${ts}\n  title: ${m.title || ''}\n  content: ${m.content || ''}`
}

export async function runConsolidator({ entity, memories }) {
  if (!memories || memories.length === 0) return { actions: 0, skipped: true }

  const input = `[Entity] ${entity}\n[Memory count] ${memories.length}\n\n` +
    memories.map(formatMemoryForConsolidator).join('\n\n')

  let actions = 0
  let skipped = false

  const onToolCall = (name, args, result) => {
    if (name === 'skip_consolidation') { skipped = true; return }
    if (name === 'merge_memories' || name === 'downgrade_memory') {
      try {
        const parsed = JSON.parse(result)
        if (parsed.ok) actions++
      } catch {}
    }
  }

  try {
    await callLLM({
      systemPrompt: CONSOLIDATOR_PROMPT,
      message: input,
      temperature: 0,
      tools: CONSOLIDATOR_TOOLS,
      thinking: false,
      mustReply: false,
      onToolCall,
      toolContext: { source: 'consolidator', entity },
    })
  } catch (err) {
    console.error('[整合器] LLM 调用失败:', err.message)
    if (err.message?.includes('429') || err.status === 429) setRateLimited()
    return { actions: 0, skipped: false, error: err.message }
  }

  console.log(`[整合器] entity=${entity} memories=${memories.length} actions=${actions} ${skipped ? '(显式跳过)' : ''}`)
  return { actions, skipped }
}
