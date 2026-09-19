import { describe, expect, it } from 'vitest'
import { bps, duration, ratio, rwa, shortHex, toNumber, usd, usdCompact, RAD, WAD } from './format'
import { dimensions, weakestLink, utilizationTone, type WeakestInputs } from './risk'
import { decodeFlags, FLAGS, STATE, usdToWad } from '../../../shared/origin-core.mjs'

describe('format', () => {
  it('converts scaled integers', () => {
    expect(toNumber(2_500n * WAD, 18)).toBe(2500)
    expect(toNumber(-15n * 10n ** 17n, 18)).toBe(-1.5)
  })
  it('formats USD, rwaUSD, bps, ratio', () => {
    expect(usd(2_500n * WAD)).toBe('$2,500.00')
    expect(usdCompact(1_250_000n * WAD)).toBe('$1.25M')
    expect(rwa(100_000n * RAD)).toBe('100,000 rwaUSD')
    expect(bps(909n)).toBe('9.09%')
    expect(ratio(16_666n)).toBe('1.67×')
    expect(ratio(2n ** 256n - 1n)).toMatch(/nothing to extract/)
  })
  it('formats durations and hex', () => {
    expect(duration(3_661)).toBe('1h 1m')
    expect(duration(90_000n)).toBe('1d 1h')
    expect(duration(-5)).toBe('0s')
    expect(shortHex('0x1234567890abcdef1234')).toBe('0x123456…1234')
  })
})

describe('shared engine helpers', () => {
  it('decodes sentinel flags by bit', () => {
    const f = (1 << 1) | (1 << 8)
    expect(decodeFlags(f).map((x) => x.key)).toEqual(['ASO_DISPUTED', 'COST_HIGH'])
    expect(decodeFlags(0)).toEqual([])
    expect(FLAGS).toHaveLength(15)
    expect(STATE).toEqual(['FRESH', 'WATCH', 'DISPUTED', 'PROTECTIVE', 'RECOVERING'])
  })
  it('converts USD to wad without float drift', () => {
    expect(usdToWad(2512.56)).toBe(251_256n * 10n ** 16n)
    expect(usdToWad(4000n)).toBe(4_000n * WAD)
  })
})

const base: WeakestInputs = {
  ageSeconds: 600, maxAge: 3600, twapOk: true, twapDeviationBps: 150, twapProtectBps: 1500,
  velocityOk: true, velocityBpsPerHour: 100, velocityProtectBpsPerHour: 2000, costRatioBps: 400_000,
  highRatioBps: 10_000, depthKnown: true, sourceDivergenceBps: 10, sourceDivergenceLimitBps: 50,
  epochUsed: 50_000, epochCap: 100_000, disputed: false, feedStale: false, vatAboveEffective: false,
}

describe('weakest link', () => {
  it('picks the dimension closest to its protect threshold', () => {
    expect(weakestLink(dimensions(base))?.key).toBe('growth') // 0.5
    expect(weakestLink(dimensions({ ...base, twapDeviationBps: 1200 }))?.key).toBe('twap') // 0.8
  })
  it('treats cheap manipulation as the weakest link', () => {
    const w = weakestLink(dimensions({ ...base, costRatioBps: 5_000 })) // cost is 0.5x extractable
    expect(w?.key).toBe('cost')
    expect(w?.utilization).toBe(2)
  })
  it('skips dimensions without data instead of inventing values', () => {
    const d = dimensions({ ...base, twapOk: false, velocityOk: false, depthKnown: false, sourceDivergenceBps: null })
    expect(d.find((x) => x.key === 'twap')?.utilization).toBeNull()
    expect(d.find((x) => x.key === 'cost')?.utilization).toBeNull()
    expect(weakestLink(d)?.key).toBe('growth')
  })
  it('maps utilization to tones', () => {
    expect(utilizationTone(null)).toBe('muted')
    expect(utilizationTone(0.2)).toBe('ok')
    expect(utilizationTone(0.7)).toBe('watch')
    expect(utilizationTone(1.3)).toBe('danger')
  })
})
