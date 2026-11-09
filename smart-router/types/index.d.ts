export type Tier = 'light' | 'standard' | 'heavy'
export type Mode = 'auto' | 'off' | Tier
export type Decision = { tier: Tier; model: string; effort: 'low' | 'medium' | 'high'; reason: string }
export type TierStats = { turns: number; input: number; output: number; cacheRead: number }
export type Stats = Record<Tier, TierStats>

declare module 'claude-code' {
  interface PluginState {
    'smart-router': {
      mode: Mode
      decision: Shaped<Decision | null>
      lastModel: string | null
      stats: Shaped<Stats>
    }
  }
}
