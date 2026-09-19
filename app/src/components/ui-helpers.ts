// Non-component helpers shared by the UI (kept apart from components for fast refresh).
import { useEffect, useState } from 'react'
import { Ban, Check, CircleAlert, Eye, GitFork, ListChecks, RotateCcw, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react'
import type { LoggedRecord } from '../lib/useOrigin'
import type { Tone } from './ui'

/** State → icon. Colour is never the only carrier of state: every badge also has an icon and a label. */
export const STATE_ICON: LucideIcon[] = [ShieldCheck, Eye, GitFork, ShieldX, RotateCcw]

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 10) return `${s.toFixed(1)}s ago`
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** How a mined record should read: success, a revert the scenario expected, or an unexpected outcome. */
export function recordView(rec: LoggedRecord): { tone: Tone; icon: LucideIcon; tag: string } {
  if (rec.kind === 'check') return rec.pass ? { tone: 'ok', icon: ListChecks, tag: 'State check passed' } : { tone: 'danger', icon: CircleAlert, tag: 'Check failed' }
  if (!rec.pass) return { tone: 'danger', icon: CircleAlert, tag: rec.status === 'reverted' ? 'Unexpected revert' : 'Expected a revert' }
  if (rec.status === 'reverted') return { tone: 'watch', icon: Ban, tag: 'Reverted as expected' }
  return { tone: 'ok', icon: Check, tag: 'Confirmed' }
}

