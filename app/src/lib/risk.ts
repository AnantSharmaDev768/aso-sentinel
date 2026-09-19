// Presentation-side risk helpers. Enforcement lives on-chain (OriginSentinel); these only EXPLAIN it.

export const STATE_INFO = [
  { name: 'FRESH', tone: 'ok', borrowing: 'Open', meaning: 'Data is valid and recent, no risk signal. Borrowing within the gap, maxLine and the epoch cap.' },
  { name: 'WATCH', tone: 'watch', borrowing: 'Limited', meaning: 'A warning signal is active. Borrowing is limited to a share of the normal headroom.' },
  { name: 'DISPUTED', tone: 'disputed', borrowing: 'Blocked', meaning: 'Sources disagree beyond tolerance. New debt is blocked.' },
  { name: 'PROTECTIVE', tone: 'danger', borrowing: 'Blocked', meaning: 'Integrity failure or material market risk. New debt is blocked.' },
  { name: 'RECOVERING', tone: 'recover', borrowing: 'Blocked', meaning: 'Signals are healthy again. Waiting for a new accepted round and the recovery delay.' },
] as const

export type Tone = (typeof STATE_INFO)[number]['tone'] | 'muted'

export interface Dimension {
  key: string
  label: string
  /** 0 = no pressure, 1 = at the PROTECTIVE threshold, >1 = beyond it. null = no data. */
  utilization: number | null
  detail: string
}

export interface WeakestInputs {
  ageSeconds: number // time since the accepted round was observed
  maxAge: number
  twapOk: boolean
  twapDeviationBps: number
  twapProtectBps: number
  velocityOk: boolean
  velocityBpsPerHour: number
  velocityProtectBpsPerHour: number
  costRatioBps: number | null // null = no extractable value (infinite)
  highRatioBps: number
  depthKnown: boolean
  sourceDivergenceBps: number | null // null = no per-source record for the latest round
  sourceDivergenceLimitBps: number
  epochUsed: number // net debt growth this epoch [rwaUSD]
  epochCap: number
  disputed: boolean
  feedStale: boolean
  vatAboveEffective: boolean
}

/**
 * Weakest link = the dimension closest to (or furthest beyond) its PROTECTIVE threshold.
 * Utilization per dimension (documented in docs/ORIGIN.md):
 *   freshness   age / maxAge
 *   TWAP        deviation / twapProtectBps           (null if TWAP history is insufficient)
 *   velocity    velocity / velocityProtectBps        (null if < 2 observations)
 *   cost gate   highRatioBps / (cost / extractable)  (0 if nothing is extractable; null if depth unknown)
 *   sources     divergence / sourceDivergenceBps     (1 if the round is DISPUTED)
 *   growth      epoch net growth / epoch cap
 *   Multipli feed / Vat vs effective price: binary (1 when flagged, else 0)
 */
export function dimensions(i: WeakestInputs): Dimension[] {
  const d: Dimension[] = [
    { key: 'freshness', label: 'Oracle freshness', utilization: i.maxAge > 0 ? i.ageSeconds / i.maxAge : null, detail: `${Math.round(i.ageSeconds)} s old of ${i.maxAge} s allowed` },
    { key: 'twap', label: 'TWAP deviation', utilization: i.twapOk ? i.twapDeviationBps / i.twapProtectBps : null, detail: i.twapOk ? `${(i.twapDeviationBps / 100).toFixed(2)}% of ${(i.twapProtectBps / 100).toFixed(0)}% protect threshold` : 'not enough history' },
    { key: 'velocity', label: 'Price velocity', utilization: i.velocityOk ? i.velocityBpsPerHour / i.velocityProtectBpsPerHour : null, detail: i.velocityOk ? `${(i.velocityBpsPerHour / 100).toFixed(2)}%/h of ${(i.velocityProtectBpsPerHour / 100).toFixed(0)}%/h` : 'needs two rounds' },
    {
      key: 'cost',
      label: 'Manipulation cost',
      utilization: !i.depthKnown ? null : i.costRatioBps === null ? 0 : i.costRatioBps === 0 ? Infinity : i.highRatioBps / i.costRatioBps,
      detail: !i.depthKnown ? 'depth assumption missing/stale' : i.costRatioBps === null ? 'nothing extractable' : `cost is ${(i.costRatioBps / 10_000).toFixed(2)}× extractable value`,
    },
    {
      key: 'sources',
      label: 'Source divergence',
      utilization: i.disputed ? 1 : i.sourceDivergenceBps === null ? null : i.sourceDivergenceBps / i.sourceDivergenceLimitBps,
      detail: i.disputed ? 'round DISPUTED' : i.sourceDivergenceBps === null ? 'no per-source record for this round' : `${(i.sourceDivergenceBps / 100).toFixed(2)}% weighted vs plain median`,
    },
    { key: 'growth', label: 'Borrowing growth', utilization: i.epochCap > 0 ? i.epochUsed / i.epochCap : null, detail: `${Math.round(i.epochUsed).toLocaleString('en-US')} of ${Math.round(i.epochCap).toLocaleString('en-US')} rwaUSD this epoch` },
    { key: 'feed', label: 'Multipli feed', utilization: i.feedStale ? 1 : 0, detail: i.feedStale ? "adapter reports stale" : 'adapter valid' },
    { key: 'vat', label: 'Vat vs effective price', utilization: i.vatAboveEffective ? 1 : 0, detail: i.vatAboveEffective ? 'Vat lends above the effective price' : 'within tolerance' },
  ]
  return d
}

export function weakestLink(dims: Dimension[]): Dimension | null {
  let best: Dimension | null = null
  for (const d of dims) {
    if (d.utilization === null) continue
    if (!best || (best.utilization ?? -1) < d.utilization) best = d
  }
  return best
}

export function utilizationTone(u: number | null): Tone {
  if (u === null) return 'muted'
  if (u >= 1) return 'danger'
  if (u >= 0.5) return 'watch'
  return 'ok'
}
