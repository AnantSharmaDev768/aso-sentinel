import type { OriginReadout, Urn } from '../../../shared/origin-core.mjs'
import { decodeFlags } from '../../../shared/origin-core.mjs'
import { dimensions, weakestLink, type WeakestInputs } from './risk'
import { RAY, toNumber, WAD } from './format'

const MAX = 2n ** 255n

export function derive(r: OriginReadout) {
  const s = r.snapshot
  const flags = decodeFlags(s.flags)
  const [maxLine, gap, watchGapBps, maxPriceGapBps] = r.limits
  const [twapWatchBps, twapProtectBps, velWatch, velProtect, sourceDivBps, recoveryDelay] = r.thresholds
  const [epochDuration, epochCap] = r.epochConfig
  const now = Number(r.chain.timestamp)
  const age = now - Number(r.verifier.observedAt)
  const depthKnown = r.risk.depth > 0n && now - Number(r.risk.depthAt) <= r.risk.maxDepthAge
  const latestRecorded = r.risk.weightedNonce !== 0n && r.risk.weightedNonce === r.verifier.lastAcceptedNonce
  const srcDiv = latestRecorded && r.verifier.price > 0n
    ? Number(((r.risk.weightedMedian > r.verifier.price ? r.risk.weightedMedian - r.verifier.price : r.verifier.price - r.risk.weightedMedian) * 10_000n) / r.verifier.price)
    : null
  const costRatio = s.costQuote.extractableUsd === 0n || s.costQuote.ratioBps >= MAX ? null : Number(s.costQuote.ratioBps)
  const epochUsed = s.debt > s.epochStartDebt ? toNumber(s.debt - s.epochStartDebt, 45) : 0

  const inputs: WeakestInputs = {
    ageSeconds: age,
    maxAge: Number(r.verifier.maxAge),
    twapOk: s.twapOk,
    twapDeviationBps: Number(s.twapDeviationBps),
    twapProtectBps: Number(twapProtectBps),
    velocityOk: s.velocityOk,
    velocityBpsPerHour: Number(s.velocityBpsPerHour),
    velocityProtectBpsPerHour: Number(velProtect),
    costRatioBps: costRatio,
    highRatioBps: r.risk.highRatio,
    depthKnown,
    sourceDivergenceBps: srcDiv,
    sourceDivergenceLimitBps: Number(sourceDivBps),
    epochUsed,
    epochCap: toNumber(epochCap, 45),
    disputed: r.verifier.status === 3,
    feedStale: flags.some((f) => f.key === 'FEED_STALE'),
    vatAboveEffective: flags.some((f) => f.key === 'VAT_ABOVE_EFFECTIVE'),
  }
  const dims = dimensions(inputs)
  const restricted = s.state >= 2
  const borrowing = restricted ? 'Blocked' : s.state === 1 ? 'Limited' : 'Open'
  const recoveryRemaining = s.state === 4 ? Math.max(0, Number(s.recoveryReadyAt) - now) : 0

  return {
    s, flags, now, age, depthKnown, latestRecorded, srcDiv, costRatio, dims, weakest: weakestLink(dims), restricted, borrowing,
    recoveryRemaining,
    limits: { maxLine, gap, watchGapBps, maxPriceGapBps },
    thresholds: { twapWatchBps, twapProtectBps, velWatch, velProtect, sourceDivBps, recoveryDelay },
    epoch: { duration: epochDuration, cap: epochCap, used: epochUsed },
  }
}

/** Debt above the collateral's value at `priceWad` (0 if covered). urn: ink [wad], art [wad], rate [ray]. */
export function badDebt(u: Urn, rate: bigint, priceWad: bigint): bigint {
  const debt = (u.art * rate) / RAY // wad
  const value = (u.ink * priceWad) / WAD
  return debt > value ? debt - value : 0n
}
