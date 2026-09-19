import { useMemo, useState } from 'react'
import { Table2, LineChart } from 'lucide-react'
import { toNumber, usd, duration } from '../lib/format'
import { simTime } from '../lib/chain'
import type { ChainEvent } from '../lib/events'
import { EmptyState } from './ui'

interface Obs { price: bigint; timestamp: bigint; nonce: bigint }

/** Same algorithm as ASORiskEngine.twap(): each accepted price holds until the next; average over the window. */
function twapAt(obs: { t: number; p: number }[], at: number, window: number, minCoverage: number): number | null {
  const start = at - window
  let covered = 0
  let sum = 0
  for (let i = 0; i < obs.length; i++) {
    const segStart = Math.max(obs[i].t, start)
    const segEnd = Math.min(i + 1 < obs.length ? obs[i + 1].t : at, at)
    if (segEnd > segStart) { covered += segEnd - segStart; sum += obs[i].p * (segEnd - segStart) }
  }
  return covered > 0 && covered / window >= minCoverage ? sum / covered : null
}

/**
 * Accepted-round prices (gold step line) with the TWAP (blue, dashed) and the TWAP watch band.
 * Disputed rounds (from RoundDisputed events) are marked; they never enter the price history.
 */
export function PriceChart({ observations, events, now, window, minCoverageBps, watchBps, contractTwap, twapOk }: {
  observations: Obs[]; events: ChainEvent[]; now: bigint; window: number; minCoverageBps: number; watchBps: number; contractTwap: bigint; twapOk: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const pts = useMemo(() => [...observations].reverse().map((o) => ({ t: Number(o.timestamp), p: toNumber(o.price, 18), nonce: o.nonce })), [observations])
  const nowN = Number(now)
  const disputes = events.filter((e) => e.kind === 'disputed' && e.price !== undefined).map((e) => ({ t: Number(e.time), p: toNumber(e.price!, 18), nonce: e.nonce! })).filter((d) => pts.length && d.t >= pts[0].t)
  if (pts.length < 2) return <EmptyState icon={LineChart} title="Not enough accepted rounds">Run a scenario or submit another round to draw the price history.</EmptyState>

  const W = 760
  const H = 260
  const P = { l: 62, r: 96, t: 16, b: 32 }
  const t0 = pts[0].t
  const t1 = Math.max(nowN, pts[pts.length - 1].t + 1)
  const cov = minCoverageBps / 10_000
  const samples = 60
  const twapLine = Array.from({ length: samples + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / samples
    return { t, v: twapAt(pts, t, window, cov) }
  })
  const vals = [...pts.map((x) => x.p), ...twapLine.map((x) => x.v ?? pts[0].p), ...disputes.map((d) => d.p)]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.14, hi * 0.02)
  lo -= pad
  hi += pad
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  let d = ''
  pts.forEach((p, i) => { d += i === 0 ? `M${x(p.t)},${y(p.p)}` : `H${x(p.t)}V${y(p.p)}` })
  d += `H${x(t1)}`
  const segs: string[] = []
  let cur = ''
  for (const s of twapLine) {
    if (s.v === null) { if (cur) segs.push(cur); cur = ''; continue }
    cur += `${cur ? 'L' : 'M'}${x(s.t)},${y(s.v)}`
  }
  if (cur) segs.push(cur)
  const band = twapLine.filter((s) => s.v !== null)
  const w = watchBps / 10_000
  const bandPath = band.length > 1
    ? `M${band.map((s) => `${x(s.t)},${y(s.v! * (1 + w))}`).join('L')}L${[...band].reverse().map((s) => `${x(s.t)},${y(s.v! * (1 - w))}`).join('L')}Z`
    : ''
  const ticks = [0.15, 0.5, 0.85].map((f) => lo + (hi - lo) * f)
  const xt = [0, 0.5, 1].map((f) => t0 + (t1 - t0) * f)
  const last = pts[pts.length - 1]
  const tw = twapOk ? toNumber(contractTwap, 18) : null
  const outside = tw !== null && Math.abs(last.p - tw) / tw >= w
  const hp = hover === null ? null : pts[hover]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row between">
        <div className="legend" aria-label="Legend">
          <span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--chart-price)" strokeWidth="2.5" /></svg>Accepted price</span>
          <span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--chart-twap)" strokeWidth="2" strokeDasharray="5 3" /></svg>TWAP (6 h)</span>
          <span><svg width="16" height="10" aria-hidden="true"><rect x="0" y="1" width="16" height="8" fill="var(--chart-twap)" opacity="0.14" /></svg>±{(w * 100).toFixed(0)}% watch band</span>
          {disputes.length > 0 && <span><svg width="12" height="12" aria-hidden="true"><path d="M2 2L10 10M10 2L2 10" stroke="var(--disputed)" strokeWidth="2" /></svg>Disputed round</span>}
        </div>
        <button className="btn sm ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? <LineChart size={14} /> : <Table2 size={14} />}{asTable ? 'Chart' : 'Table'}</button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Round</th><th>Chain time</th><th className="r">Accepted price</th><th className="r">TWAP at that time</th></tr></thead>
            <tbody>{[...pts].reverse().map((p) => { const tv = twapAt(pts, p.t, window, cov); return <tr key={String(p.nonce)}><td className="mono">#{String(p.nonce)}</td><td className="mono">{simTime(p.t, duration)}</td><td className="r">${p.p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="r">{tv === null ? '—' : `$${tv.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</td></tr> })}</tbody>
          </table>
        </div>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accepted round prices over chain time, with the TWAP and its watch band">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
                <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{`$${Math.round(v).toLocaleString('en-US')}`}</text>
              </g>
            ))}
            {xt.map((t, i) => <text key={t} x={x(t)} y={H - 10} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize="11" fill="var(--muted)">{simTime(t, duration)}</text>)}
            {bandPath && <path d={bandPath} fill="var(--chart-twap)" opacity="0.12" />}
            {segs.map((sg) => <path key={sg} d={sg} fill="none" stroke="var(--chart-twap)" strokeWidth="2" strokeDasharray="6 4" />)}
            <path d={d} fill="none" stroke="var(--chart-price)" strokeWidth="2.5" strokeLinejoin="round" />
            {tw !== null && <text x={W - P.r + 8} y={y(tw) + 4} fontSize="11" fill="var(--text-2)">TWAP</text>}
            <text x={W - P.r + 8} y={y(last.p) + (tw !== null && Math.abs(y(tw) - y(last.p)) < 14 ? 16 : 4)} fontSize="11" fill="var(--text-2)">{`$${Math.round(last.p).toLocaleString('en-US')}`}</text>
            {outside && <text x={x(last.t)} y={Math.max(P.t + 10, y(last.p) - 12)} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--watch)">outside watch band</text>}
            {disputes.map((q) => (
              <g key={`d${String(q.nonce)}`} aria-label={`Disputed round ${String(q.nonce)}`}>
                <path d={`M${x(q.t) - 5},${y(q.p) - 5}L${x(q.t) + 5},${y(q.p) + 5}M${x(q.t) + 5},${y(q.p) - 5}L${x(q.t) - 5},${y(q.p) + 5}`} stroke="var(--disputed)" strokeWidth="2.2" />
              </g>
            ))}
            {pts.map((p, i) => (
              <g key={String(p.nonce)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Round ${String(p.nonce)}: $${p.p}`}>
                <circle cx={x(p.t)} cy={y(p.p)} r="13" fill="transparent" />
                <circle cx={x(p.t)} cy={y(p.p)} r={hover === i ? 5.5 : 4} fill="var(--chart-price)" stroke="var(--surface)" strokeWidth="2" />
              </g>
            ))}
            {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={P.t} y2={H - P.b} stroke="var(--border-strong)" strokeDasharray="3 3" />}
          </svg>
          {hp && (() => {
            const tv = twapAt(pts, hp.t, window, cov)
            const left = (x(hp.t) / W) * 100
            return (
              <div className="chart-tip" style={{ top: 8, left: `min(max(0px, calc(${left}% - 90px)), calc(100% - 190px))` }}>
                <b>Round #{String(hp.nonce)} · accepted</b>
                <div className="r"><span>Price</span><span className="num">{usd(BigInt(Math.round(hp.p * 100)) * 10n ** 16n)}</span></div>
                <div className="r"><span>TWAP then</span><span className="num">{tv === null ? '—' : `$${tv.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</span></div>
                <div className="r"><span>Chain time</span><span className="num">{simTime(hp.t, duration)}</span></div>
              </div>
            )
          })()}
        </div>
      )}
      <p className="muted small">The TWAP line is recomputed in the browser from the accepted rounds with the contract's algorithm (for display); the value the Sentinel uses is read from <span className="mono">ASORiskEngine.twap()</span>.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- sensitivity

export interface SensSeries { label: string; color: string; dash?: string; points: { d: number; ratio: number | null }[] }

/** Cost / extractable ratio vs price inflation, one line per depth assumption. Log scale; 1× and 3× reference lines. */
export function SensitivityChart({ series, height = 260 }: { series: SensSeries[]; height?: number }) {
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null)
  const W = 760
  const H = height
  const P = { l: 56, r: 118, t: 14, b: 34 }
  const all = series.flatMap((s) => s.points.filter((p) => p.ratio !== null && p.ratio > 0)) as { d: number; ratio: number }[]
  if (!all.length) return <EmptyState icon={LineChart} title="Nothing extractable">At these inputs no inflation is profitable, so the ratio is infinite.</EmptyState>
  const ds = series[0].points.map((p) => p.d)
  const dMin = Math.min(...ds)
  const dMax = Math.max(...ds)
  const lmin = Math.floor(Math.log10(Math.min(0.5, ...all.map((p) => p.ratio))))
  const lmax = Math.ceil(Math.log10(Math.max(5, ...all.map((p) => p.ratio))))
  const x = (d: number) => P.l + ((d - dMin) / Math.max(1, dMax - dMin)) * (W - P.l - P.r)
  const y = (r: number) => P.t + (1 - (Math.log10(r) - lmin) / (lmax - lmin)) * (H - P.t - P.b)
  const decades = Array.from({ length: lmax - lmin + 1 }, (_, i) => 10 ** (lmin + i))
  const hp = hover ? { s: series[hover.s], p: series[hover.s].points[hover.i] } : null
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cost to extractable ratio versus price inflation for three market-depth assumptions (log scale)">
        {decades.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v >= 1 ? `${v.toLocaleString('en-US')}×` : `${v}×`}</text>
          </g>
        ))}
        {[{ v: 1, t: 'HIGH below 1×', c: 'var(--danger)' }, { v: 3, t: 'ELEVATED below 3×', c: 'var(--watch)' }].map((ref) => ref.v >= 10 ** lmin && ref.v <= 10 ** lmax && (
          <g key={ref.v}>
            <line x1={P.l} x2={W - P.r} y1={y(ref.v)} y2={y(ref.v)} stroke={ref.c} strokeDasharray="4 4" opacity="0.8" />
            <text x={P.l + 6} y={y(ref.v) - 5} fontSize="10.5" fill={ref.c}>{ref.t}</text>
          </g>
        ))}
        {ds.map((d) => <text key={d} x={x(d)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--muted)">+{d}%</text>)}
        {series.map((s, si) => {
          const valid = s.points.filter((p) => p.ratio !== null && p.ratio > 0) as { d: number; ratio: number }[]
          if (!valid.length) return null
          const path = valid.map((p, i) => `${i ? 'L' : 'M'}${x(p.d)},${y(p.ratio)}`).join('')
          const lastP = valid[valid.length - 1]
          return (
            <g key={s.label}>
              <path d={path} fill="none" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.dash} />
              <text x={W - P.r + 8} y={y(lastP.ratio) + 4} fontSize="11" fill="var(--text-2)">{s.label}</text>
              {s.points.map((p, i) => p.ratio !== null && p.ratio > 0 && (
                <g key={p.d} onMouseEnter={() => setHover({ s: si, i })}>
                  <circle cx={x(p.d)} cy={y(p.ratio)} r="11" fill="transparent" />
                  <circle cx={x(p.d)} cy={y(p.ratio)} r={hover && hover.s === si && hover.i === i ? 5 : 3.5} fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
                </g>
              ))}
            </g>
          )
        })}
      </svg>
      {hp && hp.p.ratio !== null && (
        <div className="chart-tip" style={{ top: 8, right: 8 }}>
          <b>{hp.s.label}</b>
          <div className="r"><span>Inflation d</span><span>+{hp.p.d}%</span></div>
          <div className="r"><span>Cost / extractable</span><span>{hp.p.ratio.toFixed(2)}×</span></div>
        </div>
      )}
    </div>
  )
}
