import { useState } from 'react'
import { toNumber, usd } from '../lib/format'

interface Obs {
  price: bigint
  timestamp: bigint
  nonce: bigint
}

/** Accepted-round prices (step line) with the TWAP as a dashed reference. Two series: legend + direct labels. */
export function PriceChart({ observations, twap, twapOk, now }: { observations: Obs[]; twap: bigint; twapOk: boolean; now: bigint }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const pts = [...observations].reverse() // oldest first
  if (pts.length === 0) return <p className="muted" style={{ fontSize: 13 }}>No accepted rounds recorded yet.</p>

  const W = 640
  const H = 200
  const P = { l: 64, r: 110, t: 12, b: 26 }
  const t0 = Number(pts[0].timestamp)
  const t1 = Math.max(Number(now), Number(pts[pts.length - 1].timestamp) + 1)
  const vals = pts.map((p) => toNumber(p.price, 18))
  const tw = twapOk ? toNumber(twap, 18) : null
  let lo = Math.min(...vals, tw ?? Infinity)
  let hi = Math.max(...vals, tw ?? -Infinity)
  const pad = Math.max((hi - lo) * 0.12, hi * 0.01)
  lo -= pad
  hi += pad
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)

  // step path: each price holds until the next observation (same as the on-chain TWAP)
  let d = ''
  pts.forEach((p, i) => {
    const xi = x(Number(p.timestamp))
    const yi = y(vals[i])
    d += i === 0 ? `M${xi},${yi}` : `H${xi}V${yi}`
  })
  d += `H${x(t1)}`
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1]
  const hp = hover === null ? null : pts[hover]

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="flow" style={{ justifyContent: 'space-between' }}>
        <div className="flow" style={{ fontSize: 12.5 }} aria-label="Legend">
          <span className="flow" style={{ gap: 6 }}><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--chart-price)" strokeWidth="2" /></svg>Attested round price</span>
          <span className="flow" style={{ gap: 6 }}><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--chart-twap)" strokeWidth="2" strokeDasharray="4 3" /></svg>TWAP {twapOk ? '' : '(insufficient history)'}</span>
        </div>
        <button className="btn small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</button>
      </div>
      {asTable ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Round</th><th>Observed (chain time)</th><th className="r">Price</th></tr></thead>
            <tbody>{[...pts].reverse().map((p) => <tr key={String(p.nonce)}><td className="mono">#{String(p.nonce)}</td><td className="mono">{String(p.timestamp)}</td><td className="r">{usd(p.price)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Accepted round prices over chain time with the TWAP" onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
                <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{`$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}</text>
              </g>
            ))}
            {tw !== null && (
              <>
                <line x1={P.l} x2={W - P.r} y1={y(tw)} y2={y(tw)} stroke="var(--chart-twap)" strokeWidth="2" strokeDasharray="5 4" />
                <text x={W - P.r + 6} y={y(tw) + 4} fontSize="11" fill="var(--text-2)">TWAP</text>
              </>
            )}
            <path d={d} fill="none" stroke="var(--chart-price)" strokeWidth="2" strokeLinejoin="round" />
            <text x={W - P.r + 6} y={y(vals[vals.length - 1]) + (tw !== null && Math.abs(y(tw) - y(vals[vals.length - 1])) < 14 ? 16 : 4)} fontSize="11" fill="var(--text-2)">{`latest ${usd(pts[pts.length - 1].price, 0)}`}</text>
            {pts.map((p, i) => (
              <g key={String(p.nonce)} onMouseEnter={() => setHover(i)}>
                <circle cx={x(Number(p.timestamp))} cy={y(vals[i])} r="12" fill="transparent" />
                <circle cx={x(Number(p.timestamp))} cy={y(vals[i])} r="4" fill="var(--chart-price)" stroke="var(--surface)" strokeWidth="2" />
              </g>
            ))}
          </svg>
          {hp && (
            <div className="badge" style={{ position: 'absolute', top: 4, left: P.l, background: 'var(--surface-3)', color: 'var(--text)' }}>
              Round #{String(hp.nonce)} · {usd(hp.price)} · t={String(hp.timestamp)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
