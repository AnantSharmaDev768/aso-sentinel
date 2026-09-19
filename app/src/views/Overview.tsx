import { ArrowRight, BadgeCheck, Coins, FlaskConical, Gauge, GitCompareArrows, Landmark, ListChecks, MonitorPlay, Radio, ShieldAlert, Waves, Wallet } from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN, VERIFIER_STATUS } from '../../../shared/origin-core.mjs'
import type { ViewId } from '../App'
import { Badge, Card, LiveTag, MetricCard, Note, PageHeader, SignalRow, StatusBadge, Term, Tooltip, type Tone } from '../components/ui'
import { CompareBars, ConfusionMatrix, EventList, Pipeline, Scorecard, WhyDifferent } from '../components/viz'
import { derive } from '../lib/derive'
import { bps, duration, ratio, rwa, toNumber, usd, usdCompact } from '../lib/format'
import { headline, scorecard } from '../lib/insight'
import { STATE_INFO, utilizationTone } from '../lib/risk'
import type { OriginHook } from '../lib/useOrigin'
import { VALIDATION, pct } from '../lib/validation'

const CONCERN_TONE: Tone[] = ['ok', 'watch', 'danger', 'neutral']
const DIM_ICON = { freshness: Radio, twap: Gauge, velocity: Waves, cost: FlaskConical, sources: GitCompareArrows, growth: Coins, feed: Landmark, vat: ShieldAlert } as const

export function Overview({ o, data, go }: { o: OriginHook; data: OriginReadout; go: (v: ViewId) => void }) {
  const d = derive(data)
  const s = d.s
  const info = STATE_INFO[s.state]
  const h = headline(data, d)
  const q = s.costQuote
  const headroom = s.line > s.debt ? s.line - s.debt : 0n
  const ranked = [...d.dims].sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))
  const top = ranked[0]
  const v = VALIDATION.summary
  const baseRoom = data.baseline.line > data.baseline.debt ? data.baseline.line - data.baseline.debt : 0n

  return (
    <>
      <PageHeader title="Overview" sub="Origin // ASO Sentinel checks every oracle round, then decides how much NEW debt the lending market may take on. It never changes the price, and repayments always work."
        tags={<><LiveTag kind="live" /><LiveTag kind="local" /></>} />

      <div className="g12 stretch">
        <section className={`card accent tone-${info.tone} s-8`} aria-label="Oracle protection status">
          <div className="hero">
            <div className="h-top">
              <div style={{ display: 'grid', gap: 10 }}>
                <span className="eyebrow">Oracle protection status</span>
                <StatusBadge state={s.state} size="xl" animate />
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => go('present')}><MonitorPlay size={15} />Run protection demo</button>
                <button className="btn" onClick={() => go('validation')}><ListChecks size={15} />See validation</button>
              </div>
            </div>
            <p className="why"><b style={{ color: 'var(--tone)' }}>Why: </b>{h.why}</p>
            <div className="pills">
              <span className={`pill tone-${d.borrowing === 'Open' ? 'ok' : d.borrowing === 'Limited' ? 'watch' : 'danger'}`}><Coins size={16} aria-hidden="true" /><span className="k">New borrowing</span><span className="v">{d.borrowing}</span></span>
              <span className="pill tone-ok"><Wallet size={16} aria-hidden="true" /><span className="k">Repayments</span><span className="v">Available</span></span>
              <span className={`pill tone-${s.line === 0n ? 'danger' : 'info'}`}><Landmark size={16} aria-hidden="true" /><span className="k"><Term t="Headroom">Borrowing headroom</Term></span><span className="v" style={{ textTransform: 'none', letterSpacing: 0 }}>{rwa(headroom)}</span></span>
            </div>
            <div className="g12" style={{ gap: 12 }}>
              <div className="s-6"><span className="eyebrow">Action taken</span><p className="small t2" style={{ marginTop: 4 }}>{h.action}</p></div>
              <div className="s-6"><span className="eyebrow">What happens next</span><p className="small t2" style={{ marginTop: 4 }}>{h.next}</p></div>
            </div>
          </div>
        </section>
        <Card className="s-4" title="Security scorecard" icon={BadgeCheck} sub="Factual checks from the contracts — not a score" aside={<LiveTag kind="live" />}>
          <Scorecard checks={scorecard(data, d)} />
        </Card>
      </div>

      <div className="g12">
        <div className="s-3"><MetricCard label="Attested price" tip="Median of the latest accepted 3-of-5 signed round (ASOVerifier)." value={usd(s.attestedPrice)} sub={`round #${String(data.verifier.lastAcceptedNonce)} · verifier ${VERIFIER_STATUS[data.verifier.status]}`} /></div>
        <div className="s-3"><MetricCard label="Effective price" tip="min(attested, TWAP) — the conservative price the risk checks use." value={usd(s.effectivePrice)} sub="min(attested, TWAP)" /></div>
        <div className="s-3"><MetricCard label="TWAP (6 h)" tip="Time-weighted average of accepted rounds over 6 hours." value={s.twapOk ? usd(s.twap) : '—'} sub={s.twapOk ? `history covers ${bps(s.twapCoverageBps)} of the window` : 'not enough history yet'} /></div>
        <div className="s-3"><MetricCard label="Price deviation" tip="Distance of the attested price from its 6 h TWAP. Watch and protect thresholds are contract parameters." value={s.twapOk ? bps(s.twapDeviationBps) : '—'} sub={`watch ≥ ${bps(d.thresholds.twapWatchBps)} · protect ≥ ${bps(d.thresholds.twapProtectBps)}`} tone={!s.twapOk ? undefined : Number(s.twapDeviationBps) >= Number(d.thresholds.twapProtectBps) ? 'danger' : Number(s.twapDeviationBps) >= Number(d.thresholds.twapWatchBps) ? 'watch' : undefined} /></div>
        <div className="s-3"><MetricCard label="Price velocity" tip="Price change per hour between the last two accepted rounds." value={s.velocityOk ? `${bps(s.velocityBpsPerHour)}/h` : '—'} sub={`watch ≥ ${bps(d.thresholds.velWatch)}/h · protect ≥ ${bps(d.thresholds.velProtect)}/h`} tone={!s.velocityOk ? undefined : Number(s.velocityBpsPerHour) >= Number(d.thresholds.velProtect) ? 'danger' : Number(s.velocityBpsPerHour) >= Number(d.thresholds.velWatch) ? 'watch' : undefined} /></div>
        <div className="s-3"><MetricCard label="Debt exposure" tip="Total debt on the protected Vat." value={rwa(s.debt).replace(' rwaUSD', '')} sub="rwaUSD outstanding" /></div>
        <div className="s-3"><MetricCard label="Debt ceiling" tip="The Vat's line — the only value the Sentinel changes." value={rwa(s.line).replace(' rwaUSD', '')} sub={`set by ${info.name}`} tone={s.line === 0n ? 'danger' : undefined} /></div>
        <div className="s-3"><MetricCard label="Borrowing headroom" tip="Ceiling minus debt: new debt that can be created right now." value={rwa(headroom).replace(' rwaUSD', '')} sub={`FRESH would allow ${rwa(s.freshHeadroom)}`} tone={headroom === 0n ? 'danger' : s.state === 1 ? 'watch' : 'ok'} /></div>
      </div>

      <div className="g12">
        <Card className="s-7" title={`Why ${info.name}? Ranked signals`} icon={Gauge} sub="Each signal as a share of its PROTECTIVE threshold. The strongest one is shown first." aside={<LiveTag kind="estimate" />}>
          {top && top.utilization !== null && top.utilization > 0 ? (
            <div className={`callout tone-${utilizationTone(top.utilization)}`}>
              <span className="ico"><Gauge size={20} aria-hidden="true" /></span>
              <span className="t"><b>Strongest signal · {top.label}</b><span>{top.detail}</span></span>
              <Badge tone={utilizationTone(top.utilization)} caps square>{top.utilization === Infinity ? 'beyond threshold' : `${Math.round(top.utilization * 100)}% of protect`}</Badge>
            </div>
          ) : <Note icon={BadgeCheck}>No signal is under pressure right now.</Note>}
          <div className="signals">
            {ranked.map((x, i) => {
              const Icon = DIM_ICON[x.key as keyof typeof DIM_ICON] ?? Gauge
              return <SignalRow key={x.key} icon={Icon} tone={utilizationTone(x.utilization)} label={`${i + 1}. ${x.label}`} detail={x.detail} value={x.utilization === Infinity ? 1 : x.utilization} pctText={x.utilization === null ? 'no data' : x.utilization === Infinity ? '∞' : `${Math.round(x.utilization * 100)}%`} hot={i === 0 && (x.utilization ?? 0) > 0} />
            })}
          </div>
          <p className="muted small">Ranking and percentages are computed in the browser for explanation; the state itself comes from the contract's flags.</p>
        </Card>

        <Card className="s-5" title="Manipulation cost gate" icon={FlaskConical} sub="Would pushing the price up be worth it for an attacker?" aside={<><LiveTag kind="modelled" /><Badge tone={CONCERN_TONE[s.concern]} caps square>{CONCERN[s.concern]}</Badge></>}>
          <div className="g12" style={{ gap: 12 }}>
            <div className="s-6"><div className="kpi"><span className="kl">Estimated attack cost</span><span className="kv">{s.concern === 3 ? '—' : usdCompact(q.costUsd)}</span><span className="ks">to inflate the price {bps(q.deviationBps)}</span></div></div>
            <div className="s-6"><div className="kpi"><span className="kl"><Term t="Headroom">Extractable value</Term></span><span className="kv">{s.concern === 3 ? '—' : usdCompact(q.extractableUsd)}</span><span className="ks">bounded by the Sentinel's headroom</span></div></div>
          </div>
          <CompareBars rows={[
            { label: 'Modelled attack cost', value: toNumber(q.costUsd, 18), text: usdCompact(q.costUsd), tone: 'info' },
            { label: 'Modelled extractable value', value: toNumber(q.extractableUsd, 18), text: usdCompact(q.extractableUsd), tone: 'watch' },
          ]} />
          <div className="row between">
            <span className="small t2"><Term t="Cost / extractable" /> = <b className="num">{s.concern === 3 ? '—' : ratio(q.ratioBps)}</b></span>
            <span className="small muted">HIGH &lt; 1× · ELEVATED &lt; 3×</span>
          </div>
          <Note>Under the stated assumptions (depth {data.risk.depth > 0n ? `${usdCompact(data.risk.depth)} per 1%` : 'unset'}, loss share {data.risk.lossShare / 100}%), the modelled cost {s.concern === 0 ? 'exceeds' : 'does not sufficiently exceed'} the modelled extractable value. This is an estimate, not proof: see the Cost Lab for the formula and its limits.</Note>
        </Card>
      </div>

      <Card title="Oracle protection pipeline" icon={ArrowRight} sub="How one price travels from the sources to the borrowing decision — live values" aside={<LiveTag kind="live" />}>
        <Pipeline r={data} d={d} />
      </Card>

      <div className="g12">
        <Card className="s-7" title="Why this is different" icon={ShieldAlert} sub="Multiple sources agreeing does not mean the market price is safe">
          <WhyDifferent />
        </Card>
        <Card className="s-5" title="Baseline vs protected, right now" icon={GitCompareArrows} sub="Same Multipli contracts and price feed; only the protected Vat has the Sentinel" aside={<button className="btn sm ghost" onClick={() => go('compare')}>Details <ArrowRight size={13} /></button>}>
          <CompareBars rows={[
            { label: 'Baseline — new debt allowed now', value: toNumber(baseRoom, 45), text: rwa(baseRoom), tone: 'neutral' },
            { label: 'Protected — new debt allowed now', value: toNumber(headroom, 45), text: rwa(headroom), tone: s.line === 0n ? 'danger' : s.state === 1 ? 'watch' : 'ok' },
          ]} />
          <p className="muted small">The baseline keeps lending at the OSM price whatever the oracle risk; the protected market's ceiling follows the Sentinel state.</p>
        </Card>
      </div>

      <div className="g12">
        <Card className="s-5" title="Validation snapshot" icon={ListChecks} sub={`N = ${v.total} test cases (${v.risk} risk · ${v.healthy} healthy · ${v.degraded} degraded), run against the real contracts`}
          aside={<Tooltip align="right" content={<>Generated by <b>{VALIDATION.meta.command}</b> on {VALIDATION.meta.generatedAt.slice(0, 16).replace('T', ' ')} UTC (commit {VALIDATION.meta.gitCommit ?? 'unknown'}). Synthetic scenarios on a local chain — not real-world detection rates.</>} />}>
          <ConfusionMatrix TP={v.TP} FN={v.FN} FP={v.FP} TN={v.TN} />
          <div className="kpis">
            <div className="kpi"><span className="kl">Recall</span><span className="kv">{pct(v.recall)}</span><span className="ks">TP / (TP + FN)</span></div>
            <div className="kpi"><span className="kl">Precision</span><span className="kv">{pct(v.precision)}</span><span className="ks">TP / (TP + FP)</span></div>
            <div className="kpi"><span className="kl">False-positive rate</span><span className="kv">{pct(v.falsePositiveRate)}</span><span className="ks">FP / (FP + TN)</span></div>
          </div>
          <button className="btn" onClick={() => go('validation')}>Open validation <ArrowRight size={14} /></button>
        </Card>
        <Card className="s-7" title="Recent on-chain events" icon={Waves} sub="Read from the contracts' event logs on the local chain — nothing here is invented" aside={<LiveTag kind="local" />}>
          <div className="scroll-y" style={{ maxHeight: 440 }}>
            <EventList events={o.events} now={data.chain.timestamp} limit={10} />
          </div>
        </Card>
      </div>

      <Note icon={ShieldAlert}>
        Prototype limits: not audited; not integrated with Multipli; demo sources are team-controlled test keys; the cost model rests on a
        depth assumption; a manipulation held longer than the {duration(Number(data.risk.twapWindow))} TWAP window can become the TWAP (bounded by the
        epoch cap, not prevented); collateral withdrawal is outside this protection's scope.
      </Note>
    </>
  )
}
