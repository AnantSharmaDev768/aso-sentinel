// Run one validation case live on the dashboard's local chain (reset to the healthy snapshot first) and
// compare it with the committed final-rule result. Shared by the Validation and Scenarios pages.
import { useState } from 'react'
import { CASES, HOLDOUT, runCase, type CaseResult } from '../../../shared/validation.mjs'
import type { OriginHook } from './useOrigin'
import { RESULTS } from './validation'

export interface LiveRun { id: string; res: CaseResult | null; running: boolean; error?: string; committed?: CaseResult }

export function useLiveCase(o: OriginHook) {
  const [live, setLive] = useState<LiveRun | null>(null)
  const committedOf = (id: string) => RESULTS.final.main.cases.concat(RESULTS.final.holdout.cases).find((c) => c.id === id)
  const runLive = async (id: string) => {
    const def = [...CASES, ...HOLDOUT].find((c) => c.id === id)
    if (!def) return
    setLive({ id, res: null, running: true, committed: committedOf(id) })
    await o.reset()
    let result: CaseResult | null = null
    const ok = await o.run(`Validation ${id}`, [{ title: def.title, say: '', run: async (origin) => { result = await runCase(origin, def) } }])
    setLive({ id, res: result, running: false, error: ok ? undefined : 'the run stopped — see the error banner', committed: committedOf(id) })
  }
  return { live, runLive, committedOf }
}
