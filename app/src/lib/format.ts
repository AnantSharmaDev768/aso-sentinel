// Formatting helpers. All on-chain values are integers: wad = 1e18, ray = 1e27, rad = 1e45.

export const WAD = 10n ** 18n
export const RAY = 10n ** 27n
export const RAD = 10n ** 45n

/** bigint scaled by 10^decimals -> JS number (safe for display, not for maths). */
export function toNumber(v: bigint, decimals: number): number {
  const neg = v < 0n
  const abs = neg ? -v : v
  const scale = 10n ** BigInt(decimals)
  const whole = abs / scale
  const frac = abs % scale
  const n = Number(whole) + Number(frac) / Number(scale)
  return neg ? -n : n
}

export function usd(wad: bigint, digits = 2): string {
  return `$${toNumber(wad, 18).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function usdCompact(wad: bigint): string {
  const n = toNumber(wad, 18)
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

/** rad (1e45) amount of rwaUSD. */
export function rwa(rad: bigint): string {
  return `${Math.round(toNumber(rad, 45)).toLocaleString('en-US')} rwaUSD`
}

export function bps(v: bigint | number): string {
  const n = typeof v === 'bigint' ? Number(v) : v
  return `${(n / 100).toFixed(2)}%`
}

/** cost/extractable ratio in bps; uint256 max means "no extractable value". */
export function ratio(v: bigint): string {
  if (v >= 2n ** 255n) return '∞ (nothing to extract)'
  return `${(Number(v) / 10_000).toFixed(2)}×`
}

export function duration(seconds: bigint | number): string {
  let s = Math.max(0, Math.floor(typeof seconds === 'bigint' ? Number(seconds) : seconds))
  const d = Math.floor(s / 86_400)
  s -= d * 86_400
  const h = Math.floor(s / 3_600)
  s -= h * 3_600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

export function shortHex(h: string, head = 6, tail = 4): string {
  return h.length <= head + tail + 2 ? h : `${h.slice(0, head + 2)}…${h.slice(-tail)}`
}
