// Plain-language explanations derived from LIVE contract values (no invented scores or data).
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { derive } from './derive'
import { bps, duration, rwa, usd } from './format'

type D = ReturnType<typeof derive>

/** One sentence per active flag, with the measured value that triggered it. */
export function flagReason(key: string, r: OriginReadout, d: D): string {
  const s = d.s
  switch (key) {
    case 'ASO_HALTED': return 'the verifier was halted by its guardian'
    case 'ASO_DISPUTED': return 'the latest round\'s sources disagreed by more than 1%'
    case 'ASO_NO_DATA': return 'no oracle round has been accepted yet'
    case 'ASO_STALE': return `the last accepted round is ${duration(d.age)} old (limit ${duration(Number(r.verifier.maxAge))})`
    case 'FEED_STALE': return 'Multipli\'s Chainlink-style feed is stale'
    case 'VAT_ABOVE_EFFECTIVE': return `the Vat lends at ${usd(s.vatPrice)}, more than ${bps(d.limits.maxPriceGapBps)} above the conservative price min(market, TWAP) = ${usd(s.effectivePrice)}`
    case 'TWAP_DEVIATION_PROTECT': return `the price is ${bps(s.twapDeviationBps)} away from its 6 h TWAP (protect ≥ ${bps(d.thresholds.twapProtectBps)})`
    case 'TWAP_DEVIATION_WATCH': return `the price is ${bps(s.twapDeviationBps)} away from its 6 h TWAP (watch ≥ ${bps(d.thresholds.twapWatchBps)})`
    case 'VELOCITY_PROTECT': return `the price moved ${bps(s.velocityBpsPerHour)} per hour (protect ≥ ${bps(d.thresholds.velProtect)}/h)`
    case 'VELOCITY_WATCH': return `the price moved ${bps(s.velocityBpsPerHour)} per hour (watch ≥ ${bps(d.thresholds.velWatch)}/h)`
    case 'COST_HIGH': return 'manipulation looks cheaper than what it could extract (cost gate HIGH)'
    case 'COST_ELEVATED': return 'manipulation cost is less than 3× the extractable value (cost gate ELEVATED)'
    case 'COST_NO_DATA': return 'the market-depth assumption is missing or stale'
    case 'TWAP_INSUFFICIENT': return 'there is not yet enough price history for a TWAP'
    case 'SOURCE_DIVERGENCE': return 'the weighted-median of sources diverges from the median'
    case 'VAT_ABOVE_TWAP': return `the Vat lends more than ${bps(d.thresholds.twapWatchBps)} above the 6 h TWAP`
    case 'SOURCE_COVERAGE_MIN': return `only ${r.risk.weightedSourceCount} of 5 sources signed the latest round (the minimum quorum)`
    default: return key
  }
}

export function headline(r: OriginReadout, d: D): { why: string; action: string; next: string } {
  const s = d.s
  const reasons = d.flags.map((f) => flagReason(f.key, r, d))
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('; ')} and ${xs[xs.length - 1]}`)
  switch (s.state) {
    case 0:
      return {
        why: 'Everything is healthy: oracle data is fresh, sources agree, and no risk signal is active.',
        action: `Normal borrowing — up to ${rwa(s.line > s.debt ? s.line - s.debt : 0n)} of new debt (gap, max line and the daily growth cap all apply).`,
        next: 'Every poke re-checks all signals. Any warning immediately limits borrowing.',
      }
    case 1:
      return {
        why: `A warning signal is active: ${list(reasons) || 'see the signals below'}. New borrowing is limited while repayments remain available.`,
        action: `New borrowing limited to ${rwa(s.line > s.debt ? s.line - s.debt : 0n)} (25% of the normal gap). Repayments work.`,
        next: 'Returns to FRESH when the warning clears; escalates to PROTECTIVE if a protect threshold is crossed.',
      }
    case 2:
      return {
        why: 'Authorized sources disagree. New borrowing is blocked until a valid agreeing round is accepted.',
        action: 'New borrowing frozen (debt ceiling 0). Repayments work.',
        next: 'Needs an agreeing round, then RECOVERING: a newer accepted round and the 1 h delay before borrowing reopens.',
      }
    case 3:
      return {
        why: `Market-risk signals are severe: ${list(reasons) || 'a protective signal fired'}. New borrowing is blocked to limit additional exposure.`,
        action: 'New borrowing frozen (debt ceiling 0). Repayments work.',
        next: 'When every signal clears the Sentinel moves to RECOVERING — never straight back to FRESH.',
      }
    default: {
      const left = d.recoveryRemaining
      const need = [!s.recoveryRoundSeen && 'a newer accepted round', left > 0 && `${duration(left)} more of the recovery delay`].filter(Boolean) as string[]
      return {
        why: 'Risk has cleared, but borrowing is reopening gradually while the system confirms a clean price history.',
        action: 'New borrowing stays frozen (debt ceiling 0). Repayments work.',
        next: need.length ? `Borrowing reopens after ${list(need)}.` : 'All recovery conditions are met: the next poke reopens borrowing.',
      }
    }
  }
}

export type Check = { label: string; status: 'PASS' | 'WATCH' | 'BLOCKED' | 'WAITING' | 'N/A'; detail: string; term?: string }

/** Factual checks, each tied to a contract flag or value. Deliberately NOT a 0–100 score. */
export function scorecard(r: OriginReadout, d: D): Check[] {
  const has = (k: string) => d.flags.some((f) => f.key === k)
  const s = d.s
  const coverage = r.risk.weightedNonce !== 0n && r.risk.weightedNonce === r.verifier.lastAcceptedNonce ? r.risk.weightedSourceCount : null
  const epochShare = d.epoch.cap > 0n ? d.epoch.used / Number(d.epoch.cap / 10n ** 45n) : 0
  return [
    { label: 'Oracle freshness', term: 'Freshness', status: has('ASO_STALE') || has('ASO_NO_DATA') ? 'BLOCKED' : 'PASS', detail: `${duration(d.age)} old · limit ${duration(Number(r.verifier.maxAge))}` },
    { label: 'Quorum & signatures', term: 'Quorum', status: r.verifier.status === 1 ? 'PASS' : 'BLOCKED', detail: `${String(r.verifier.quorum)} of 5 required · verifier ${['NO DATA', 'OK', 'STALE', 'DISPUTED', 'HALTED'][r.verifier.status]}` },
    { label: 'Source agreement', status: has('ASO_DISPUTED') ? 'BLOCKED' : has('SOURCE_DIVERGENCE') ? 'WATCH' : 'PASS', detail: has('ASO_DISPUTED') ? 'spread > 1%: DISPUTED' : 'within 1%' },
    { label: 'Source availability', status: has('SOURCE_COVERAGE_MIN') ? 'WATCH' : coverage === null ? 'N/A' : 'PASS', detail: coverage === null ? 'no per-source record for the latest round' : `${coverage} of 5 signed the latest round` },
    { label: 'TWAP deviation', term: 'TWAP', status: has('TWAP_DEVIATION_PROTECT') ? 'BLOCKED' : has('TWAP_DEVIATION_WATCH') || has('TWAP_INSUFFICIENT') ? 'WATCH' : 'PASS', detail: s.twapOk ? `${bps(s.twapDeviationBps)} from TWAP` : 'not enough history' },
    { label: 'Price velocity', status: has('VELOCITY_PROTECT') ? 'BLOCKED' : has('VELOCITY_WATCH') ? 'WATCH' : 'PASS', detail: s.velocityOk ? `${bps(s.velocityBpsPerHour)}/h` : 'needs two rounds' },
    { label: 'Manipulation economics', term: 'Cost / extractable', status: has('COST_HIGH') ? 'BLOCKED' : has('COST_ELEVATED') || has('COST_NO_DATA') ? 'WATCH' : 'PASS', detail: ['LOW concern', 'ELEVATED', 'HIGH concern', 'insufficient data'][s.concern] },
    { label: 'Multipli feed & Vat price', term: 'OSM', status: has('FEED_STALE') || has('VAT_ABOVE_EFFECTIVE') ? 'BLOCKED' : 'PASS', detail: has('VAT_ABOVE_EFFECTIVE') ? 'Vat lends > 2% above min(market, TWAP)' : has('FEED_STALE') ? 'feed stale' : `Vat lends at ${usd(s.vatPrice)}` },
    { label: 'Debt growth (epoch)', term: 'Epoch', status: epochShare >= 1 ? 'BLOCKED' : epochShare >= 0.8 ? 'WATCH' : 'PASS', detail: `${Math.round(epochShare * 100)}% of the daily cap used` },
    { label: 'Recovery readiness', term: 'Recovery delay', status: s.state === 4 ? (s.recoveryRoundSeen && d.recoveryRemaining === 0 ? 'PASS' : 'WAITING') : 'N/A', detail: s.state === 4 ? `${s.recoveryRoundSeen ? 'new round seen' : 'waiting for a new round'} · ${d.recoveryRemaining > 0 ? `${duration(d.recoveryRemaining)} left` : 'delay met'}` : 'not recovering' },
  ]
}

export const CHECK_TONE = { PASS: 'ok', WATCH: 'watch', BLOCKED: 'danger', WAITING: 'recover', 'N/A': 'neutral' } as const
