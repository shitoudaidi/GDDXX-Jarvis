// 成果审视类工具 schema。
//   review_work    —— 主 Agent 调：把刚做完的成果交给一个独立的"审视分身"复查（换提示词、换上下文，
//                      不是子 agent）。审视分身只读验证后给结构化结论，作为本工具返回值丢回主 Agent。
//   review_verdict —— 审视分身内部回传结论用，主 Agent 看不到也不该调（它在审视分身那次独立 callLLM 里）。
export const reviewSchemas = {
  review_work: {
    type: 'function',
    function: {
      name: 'review_work',
      description: 'Hand your just-finished work to an independent Reviewer — a separate persona with fresh eyes that did NOT do the work and has no stake in it being right (not a sub-agent; an in-process review pass). Use it before claiming a non-trivial task done — e.g. right before complete_task, or before delivering a result that took real work (files written, a script built, multi-step research). The Reviewer independently re-checks your output against the goal using read-only tools (it opens the files you wrote, re-runs read-only checks) and returns a verdict with concrete issues. The runtime automatically gives the Reviewer the real tool-call log and task plan as evidence — you cannot omit or spin them, that independence is the point. The verdict is a second opinion, not a gate: fix what is real, then proceed; if you disagree, say why and continue.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'What was actually asked for — the original objective in plain terms, as the user would state it. Be faithful; do not narrow it to only the part you handled well.'
          },
          claim: {
            type: 'string',
            description: 'What you believe you accomplished and are about to deliver — the result, in your own words.'
          },
          artifacts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: concrete things the Reviewer should open and verify — file paths you wrote, a command to re-run, URLs, or IDs. The more verifiable, the better the review.'
          }
        },
        required: ['goal', 'claim']
      }
    }
  },

  review_verdict: {
    type: 'function',
    function: {
      name: 'review_verdict',
      description: 'Reviewer-only: deliver your structured judgment of whether the work meets the goal. Call exactly once, after you have inspected what you need. This is your sole output.',
      parameters: {
        type: 'object',
        properties: {
          pass: {
            type: 'boolean',
            description: 'true if the work genuinely meets the goal (minor notes still allowed). false if a blocker or serious gap stands between the work and the goal.'
          },
          issues: {
            type: 'array',
            description: 'Concrete problems found. Empty when the work is clean.',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['blocker', 'major', 'minor'], description: 'blocker = goal not met / broken; major = real defect the user would notice; minor = small improvement or risk.' },
                what: { type: 'string', description: 'What is wrong, specifically.' },
                where: { type: 'string', description: 'Where it is — file path, step number, or which tool result.' },
                fix_hint: { type: 'string', description: 'A concrete next action to fix it.' }
              },
              required: ['severity', 'what']
            }
          },
          summary: {
            type: 'string',
            description: 'One or two sentences: the overall judgment and, if blocking, the single most important thing to fix.'
          }
        },
        required: ['pass']
      }
    }
  },
}
