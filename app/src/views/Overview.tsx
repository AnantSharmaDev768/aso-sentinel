import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN, VERIFIER_STATUS } from '../../../shared/origin-core.mjs'
import { Badge, Card, Meter, Stat, StateBadge } from '../components/ui'
import { derive } from '../lib/derive'
import { bps, duration, ratio, rwa, usd, usdCompact } from '../lib/format'
import { STATE_INFO, utilizationTone } from '../lib/risk'

const CONCERN_TONE = ['ok', 'watch', 'danger', 'muted'] as const

export function Overview({ data }: { data: OriginReadout }) {
  const d = derive(data)
  const s = d.s
  const info = STATE_INFO[s.state]
  const q = s.costQuote
  return (
    <>
      <Card>
        <div className="hero">
          <div style={{ display: 'grid', gap: 4 }}>
            <h3>Protection status</h3>
            <StateBadge state={s.state} large />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <p className="t2">{info.meaning}</p>
            <div className="flow">
              <Badge tone={d.borrowing === 'Open' ? 'ok' : d.borrowing === 'Limited' ? 'watch' : 'danger'}>New borrowing: {d.borrowing}</Badge>
              <Badge tone="ok">Repayments: available</Badge>
              {s.target !== s.state && <Badge tone="muted">Signals point to {STATE_INFO[s.target].name}</Badge>}
              {d.s.state === 4 && <Badge tone="recover">{d.recoveryRemaining > 0 ? `Recovery delay: ${duration(d.recoveryRemaining)} left` : 'Recovery delay met'} · {s.recoveryRoundSeen ? 'new round seen' : 'waiting for a new round'}</Badge>}
            </div>
            <div className="flow">
              {d.flags.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No active risk signal.</span> : d.flags.map((f) => (
                <Badge key={f.key} tone={f.level === 'protect' ? 'danger' : f.level === 'disputed' ? 'disputed' : 'watch'} title={f.explain}>{f.label}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid g4">
        <Card className="tight"><Stat label="Attested price (median)" value={usd(s.attestedPrice)} sub={`round #${String(data.verifier.lastAcceptedNonce)} · ${VERIFIER_STATUS[data.verifier.status]}`} tip="Median of the latest accepted 3-of-5 signed round (ASOVerifier)." /></Card>
        <Card className="tight"><Stat label="Conservative effective price" value={usd(s.effectivePrice)} sub="min(attested, TWAP)" tip="The lower of the attested price and the TWAP when the TWAP is valid; otherwise the attested price (never a fabricated fallback)." /></Card>
        <Card className="tight"><Stat label="TWAP (6 h)" value={s.twapOk ? usd(s.twap) : 'insufficient'} sub={`history covers ${bps(s.twapCoverageBps)} of the window · deviation ${s.twapOk ? bps(s.twapDeviationBps) : '—'}`} tone={s.twapOk ? undefined : 'watch'} /></Card>
        <Card className="tight"><Stat label="Price velocity" value={s.velocityOk ? `${bps(s.velocityBpsPerHour)}/h` : '—'} sub={s.velocityOk ? 'between the last two accepted rounds' : 'needs two accepted rounds'} /></Card>
        <Card className="tight"><Stat label="Vat lends at" value={usd(s.vatPrice)} sub="Multipli OSM → Spotter → Vat" tip="Price implied by the protected Vat's spot (inverts Spotter.poke)." /></Card>
        <Card className="tight"><Stat label="Time since update" value={duration(d.age)} sub={`attestations valid for ${duration(Number(data.verifier.maxAge))}`} tone={d.age > Number(data.verifier.maxAge) ? 'danger' : undefined} /></Card>
        <Card className="tight"><Stat label="Debt exposure (protected)" value={rwa(s.debt)} sub={`ceiling ${rwa(s.line)}`} /></Card>
        <Card className="tight"><Stat label="Bounded headroom if FRESH" value={rwa(s.freshHeadroom)} sub={`epoch cap line ${rwa(s.epochCapLine)}`} tip="min(gap, maxLine − debt, epoch cap line − debt). Also the cost gate's extractable-value bound." /></Card>
      </div>

      <div className="grid g2">
        <Card title="Weakest link" sub="Dimension closest to (or beyond) its PROTECTIVE threshold — formula in docs/ORIGIN.md">
          {d.weakest ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="flow" style={{ justifyContent: 'space-between' }}>
                <strong>{d.weakest.label}</strong>
                <Badge tone={utilizationTone(d.weakest.utilization)}>{d.weakest.utilization === Infinity ? 'beyond' : `${Math.round((d.weakest.utilization ?? 0) * 100)}% of threshold`}</Badge>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{d.weakest.detail}</p>
            </div>
          ) : <p className="muted">Not enough data.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {d.dims.map((x) => (
              <div key={x.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 70px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span className="t2">{x.label}</span>
                <Meter value={x.utilization === Infinity ? 1 : x.utilization} tone={utilizationTone(x.utilization)} />
                <span className="num muted" style={{ textAlign: 'right' }}>{x.utilization === null ? 'no data' : x.utilization === Infinity ? '∞' : `${Math.round(x.utilization * 100)}%`}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Cost gate" sub="Estimated manipulation cost vs extractable value — a rough proxy, not a proof" right={<Badge tone={CONCERN_TONE[s.concern]}>{CONCERN[s.concern]}</Badge>}>
          <div className="grid g2">
            <Stat label="Estimated manipulation cost" value={s.concern === 3 ? '—' : usdCompact(q.costUsd)} sub={s.concern === 3 ? 'depth assumption missing or stale' : `to inflate the price ${bps(q.deviationBps)}`} />
            <Stat label="Extractable value (bounded)" value={s.concern === 3 ? '—' : usdCompact(q.extractableUsd)} sub="with the Sentinel's bounded headroom" />
            <Stat label="Cost ÷ extractable" value={s.concern === 3 ? '—' : ratio(q.ratioBps)} sub={`HIGH below ${(data.risk.highRatio / 10_000).toFixed(1)}×, ELEVATED below ${(data.risk.elevatedRatio / 10_000).toFixed(1)}×`} />
            <Stat label="Depth assumption" value={data.risk.depth > 0n ? `${usdCompact(data.risk.depth)} / 1%` : 'none'} sub="set by governance — not measured liquidity" tone={d.depthKnown ? undefined : 'watch'} />
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Baseline (no Sentinel), same assumptions: extractable {usdCompact(data.baseline.costBest.extractableUsd)} with its full
            {' '}{rwa(data.baseline.headroomWad * 10n ** 27n)} headroom → cost ÷ extractable {ratio(data.baseline.costBest.ratioBps)}.
          </p>
        </Card>
      </div>
    </>
  )
}
