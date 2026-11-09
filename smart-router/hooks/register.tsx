import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Decision, Mode, Stats, Tier } from '../types'

const P = 'smart-router' as const
const mode = atom({ plugin: 'smart-router', key: 'mode' } as const, 'auto' as Mode)
const decision = atom({ plugin: 'smart-router', key: 'decision' } as const, null as Decision | null, { shape: 'decision-1' })
const lastModel = atom({ plugin: 'smart-router', key: 'lastModel' } as const, null as string | null)
const emptyStats = (): Stats => ({
  light: { turns: 0, input: 0, output: 0, cacheRead: 0 },
  standard: { turns: 0, input: 0, output: 0, cacheRead: 0 },
  heavy: { turns: 0, input: 0, output: 0, cacheRead: 0 },
})
const stats = atom({ plugin: 'smart-router', key: 'stats' } as const, emptyStats(), { shape: 'stats-1' })

export const TIERS: Record<Tier, Omit<Decision, 'reason' | 'tier'>> = {
  light: { model: 'haiku', effort: 'low' },
  standard: { model: 'sonnet', effort: 'medium' },
  heavy: { model: 'opus', effort: 'high' },
}

// A long conversation's prompt cache is tied to the model. Switching models
// re-sends the whole history uncached, which can cost more than it saves, so
// past this size the router lowers effort but keeps the model on a downgrade.
const STICKY_AFTER_MESSAGES = 40

const HEAVY = [
  /\b(architect|architecture|refactor|redesign|migrat)/,
  /\b(debug|root cause|why (is|does|did|isn'?t|doesn'?t)|stack ?trace|not working|broken|fails?|error)\b/,
  /\b(strategy|strategic|roadmap|plan(ning)?|audit|investigate|research|analy[sz]e|analysis|deep dive)\b/,
  /\b(competitor|competitive|gap analysis|backlink profile|site ?wide|entire site|whole site|full site)\b/,
  /\b(build|create|implement) (a|an|the)? ?(system|pipeline|automation|workflow|app|tool|integration|mod|plugin)\b/,
  /\b(security|race condition|performance issue|optimi[sz]e the (system|pipeline))\b/,
  /\b(step[- ]by[- ]step|multi[- ]step|end[- ]to[- ]end|think (hard|carefully))\b/,
]
const LIGHT = [
  /^(what|where|which|who|when|is|are|does|do|can|list|show|print|open|read|rename|format|translate|summari[sz]e|define)\b/,
  /\b(typo|spelling|rename|reformat|lowercase|uppercase|word count|character count)\b/,
  /\b(meta description|title tag|alt text|slug|h1|nap|utm)\b/,
]
const FOLLOW_UP = /^(y|yes|yep|ok|okay|sure|go|go ahead|do it|continue|proceed|next|thanks|thank you|ty|looks good|lgtm|ship it)[.! ]*$/

/** Pure classifier: the prompt's text to a tier and a short reason. */
export function classify(raw: string, previous: Tier | null, hasAttachments = false): { tier: Tier; reason: string } {
  const text = raw.trim().toLowerCase()
  if (FOLLOW_UP.test(text) && previous) return { tier: previous, reason: 'follow-up, kept last tier' }

  let score = 0
  const why: string[] = []
  const heavyHits = HEAVY.reduce((n, r) => n + (text.match(new RegExp(r.source, 'g')) ?? []).length, 0)
  if (heavyHits) { score += 2 * heavyHits; why.push('complex task words') }
  if (text.length > 1200) { score += 2; why.push('long prompt') }
  else if (text.length > 500) { score += 1 }
  if ((text.match(/```/g) ?? []).length >= 2) { score += 1; why.push('code pasted') }
  if (hasAttachments) { score += 1; why.push('attachments') }
  if ((text.match(/\b(and then|after that|also|then)\b/g) ?? []).length >= 3) { score += 1; why.push('several steps') }

  const lightHit = LIGHT.some(r => r.test(text))
  if (lightHit && !heavyHits && text.length < 200) { score -= 2; why.push('quick lookup or small edit') }
  else if (text.length < 60) { score -= 1; why.push('short prompt') }

  if (score >= 3) return { tier: 'heavy', reason: why[0] ?? 'complex' }
  if (score <= -1) return { tier: 'light', reason: why[why.length - 1] ?? 'simple' }
  return { tier: 'standard', reason: why[0] ?? 'normal task' }
}

const OVERRIDE = /^!(light|fast|cheap|std|standard|heavy|deep|max)\b\s*/i
const overrideTier = (word: string): Tier =>
  /light|fast|cheap/i.test(word) ? 'light' : /heavy|deep|max/i.test(word) ? 'heavy' : 'standard'

const family = (model: string) => (/haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : /opus/i.test(model) ? 'opus' : model)
const rank: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2 }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Smart router: show status and token use, or set mode (auto | off | light | standard | heavy)',
    })
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (['auto', 'off', 'light', 'standard', 'heavy'].includes(arg)) {
      await update($, mode, () => arg as Mode)
      $.ui.status(arg === 'off' ? undefined : `router: ${arg}`)
      return { text: `Smart router mode set to ${arg}.` }
    }
    if (arg === 'reset') {
      await update($, stats, () => emptyStats())
      return { text: 'Router stats reset.' }
    }
    const m = await read($, mode)
    const d = await read($, decision)
    const s = await read($, stats)
    const rows = (Object.keys(s) as Tier[]).map(t =>
      `  ${t.padEnd(8)} ${TIERS[t].model}/${TIERS[t].effort}: ${s[t].turns} turns, ${s[t].input.toLocaleString()} in, ${s[t].cacheRead.toLocaleString()} cached, ${s[t].output.toLocaleString()} out`)
    return {
      text: [
        `Smart router — mode: ${m}`,
        d ? `Last pick: ${d.model}/${d.effort} (${d.tier}, ${d.reason})` : 'No prompt routed yet.',
        'Token use this session by tier:',
        ...rows,
        'Per-prompt override: start a prompt with !light, !std or !deep.',
      ].join('\n'),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const m = await read($, mode)
    let text = e.text
    let forced: Tier | null = null
    const o = text.match(OVERRIDE)
    if (o) { forced = overrideTier(o[1] ?? ''); text = text.slice(o[0].length) }
    if (m === 'off' && !forced) { await update($, decision, () => null); return next(e) }

    const prev = (await read($, decision))?.tier ?? null
    const picked = forced
      ? { tier: forced, reason: 'your !override' }
      : m !== 'auto'
        ? { tier: m as Tier, reason: `mode pinned to ${m}` }
        : classify(text, prev, (e.attachments?.length ?? 0) > 0)
    const d: Decision = { tier: picked.tier, ...TIERS[picked.tier], reason: picked.reason }
    await update($, decision, () => d)
    await update($, stats, s => ({ ...s, [d.tier]: { ...s[d.tier], turns: s[d.tier].turns + 1 } }))
    $.ui.status(`⚙ ${d.model}·${d.effort} — ${d.reason}`)
    return next(o ? { ...e, text } : e)
  })

  on('turn.step', async function* ($, e, next) {
    const d = await read($, decision)
    if (!d) return yield* next(e)

    let model = d.model
    let effort: Decision['effort'] = d.effort
    if (e.agentId !== undefined) {
      // Subagents do search and legwork: cap them at Sonnet / medium.
      if (d.tier === 'heavy') { model = TIERS.standard.model; effort = TIERS.standard.effort }
    } else {
      const last = await read($, lastModel)
      if (last && e.messageCount > STICKY_AFTER_MESSAGES && (rank[family(model)] ?? 1) < (rank[family(last)] ?? 1)) {
        model = last // keep the warm cache; effort still drops
      }
    }

    const res = yield* next({ ...e, model, effort })
    if (e.agentId === undefined) await update($, lastModel, () => model)
    if (res.usage) {
      const u = res.usage
      await update($, stats, s => ({
        ...s,
        [d.tier]: {
          ...s[d.tier],
          input: s[d.tier].input + u.input_tokens + u.cache_creation_input_tokens,
          cacheRead: s[d.tier].cacheRead + u.cache_read_input_tokens,
          output: s[d.tier].output + u.output_tokens,
        },
      }))
    }
    return res
  })

  // Output tokens are the expensive ones: ask for lean answers on every turn.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if ((await read($, mode)) === 'off') return r
    return {
      ...r,
      sections: [
        ...r.sections,
        {
          id: `${P}:lean`,
          scope: 'session' as const,
          text: 'Token budget: answer in the fewest words that fully do the job. No preamble, no recap of what you did, no closing offers. Read only the parts of files you need. Prefer targeted searches over reading whole directories. Client-facing drafts and documents still get full detail.',
        },
      ],
    }
  })
}
