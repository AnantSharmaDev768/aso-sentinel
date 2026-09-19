import { Activity, BadgeCheck, Clock, Hash, LineChart, Radio, RotateCcw, ShieldAlert, Signature, Users } from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { VERIFIER_STATUS } from '../../../shared/origin-core.mjs'
import { Badge, Card, LiveTag, Note, PageHeader, ProgressBar, Term, Tooltip, type Tone } from '../components/ui'
import { PriceChart } from '../components/charts'
import { derive } from '../lib/derive'
import { bps, duration, shortHex, usd } from '../lib/format'
import type { OriginHook } from '../lib/useOrigin'
import { caseById, OUTCOME_TONE } from '../lib/validation'

function diff(a: bigint, b: bigint): { text: string; bps: number } {
  if (a === 0n || b === 0n) return { text: '—', bps: 0 }
  const d = a > b ? a - b : b - a
  const v = Number((d * 10_000n) / b)
  return { text: `${a >= b ? '+' : '−'}${bps(v)}`, bps: v }
}

const AVAILABILITY = [
  { online: 5, id: 'S5', policy: 'Normal: quorum with two spare sources' },
  { online: 4, id: 'S4', policy: 'Normal: quorum with one spare source' },
  { online: 3, id: 'S3', policy: 'WATCH: exactly the quorum, no redundancy left' },
  { online: 2, id: 'S2', policy: 'No new round possible → PROTECTIVE once the last round is 1 h old' },
  { online: 1, id: 'S1', policy: 'No new round possible → PROTECTIVE once stale' },
  { online: 0, id: 'S0', policy: 'No data → PROTECTIVE once stale' },
]

export function OracleView({ o, data }: { o: OriginHook; data: OriginReadout }) {
  const d = derive(data)
  const v = data.verifier
  const now = data.chain.timestamp
  const totalWeight = data.sources.reduce((a, s) => a + s.weight, 0)
  const recorded = data.risk.weightedNonce !== 0n && data.risk.weightedNonce === v.lastAcceptedNonce
  const inLatest = data.sources.filter((s) => s.nonce === data.risk.weightedNonce && recorded).length
  const vTone: Tone = v.status === 1 ? 'ok' : v.status === 3 ? 'disputed' : 'danger'
  const stale = now > v.expiresAt || d.age > Number(v.maxAge)
  const coverageTone: Tone = !recorded ? 'neutral' : inLatest <= Number(v.quorum) ? 'watch' : 'ok'

  return (
    <>
      <PageHeader title="Oracle Monitoring" sub="Is the price data cryptographically and structurally valid? Five authorised sources sign EIP-712 attestations; ASOVerifier accepts a round only with a 3-of-5 quorum that agrees within 1%."
        tags={<><LiveTag kind="live" /><LiveTag kind="local" /></>} />

      <div className="kpis">
        <div className={`kpi tone-${vTone}`}><span className="kl"><Signature size={12} />Verifier</span><span className="kv ink">{VERIFIER_STATUS[v.status]}</span><span className="ks">{v.status === 1 ? 'signatures, quorum and agreement valid' : 'no trusted price'}</span></div>
        <div className={`kpi tone-${coverageTone}`}><span className="kl"><Users size={12} />Sources online</span><span className="kv">{recorded ? `${inLatest} / 5` : '— / 5'}</span><span className="ks">{recorded ? 'signed the latest recorded round' : 'no per-source record for this round'}</span></div>
        <div className="kpi"><span className="kl"><BadgeCheck size={12} /><Term t="Quorum">Quorum</Term></span><span className="kv">{String(v.quorum)} of 5</span><span className="ks">strict majority required</span></div>
        <div className="kpi"><span className="kl"><Hash size={12} />Accepted round</span><span className="kv">#{String(v.lastAcceptedNonce)}</span><span className="ks">{v.lastNonce !== v.lastAcceptedNonce ? `round #${String(v.lastNonce)} was disputed` : 'latest round accepted'}</span></div>
        <div className={`kpi tone-${stale ? 'danger' : 'ok'}`}><span className="kl"><Clock size={12} /><Term t="Freshness">Freshness</Term></span><span className="kv">{duration(d.age)}</span><span className="ks">{stale ? 'STALE — past max age' : `valid ${duration(Number(v.expiresAt - now))} more`}</span></div>
        <div className="kpi"><span className="kl"><RotateCcw size={12} />Replay protection</span><span className="kv">&gt; #{String(v.lastNonce)}</span><span className="ks">next round number must be higher</span></div>
      </div>

      <div className="g12">
        <Card className="s-8" title="Accepted price history" icon={LineChart} sub="Only rounds the verifier ACCEPTED enter the history. Disputed rounds are marked but never move the price." aside={<LiveTag kind="local" />}>
          <PriceChart observations={data.risk.observations} events={o.events} now={now} window={Number(data.risk.twapWindow)} minCoverageBps={data.risk.minCoverage} watchBps={Number(d.thresholds.twapWatchBps)} contractTwap={data.snapshot.twap} twapOk={data.snapshot.twapOk} />
        </Card>
        <Card className="s-4" title="Source availability policy" icon={Activity} sub="What happens as sources go offline (quorum 3 of 5). Outcomes measured by the validation suite."
          aside={<Tooltip align="right" content="Availability is visible on-chain only through the per-source record (recordSources). With fewer than 3 sources no round can be accepted; the last one stays valid for up to 1 h." />}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Online</th><th>Policy</th><th>Measured</th></tr></thead>
              <tbody>
                {AVAILABILITY.map((a) => {
                  const c = caseById(a.id)
                  return (
                    <tr key={a.online}>
                      <td className="num"><b>{a.online}/5</b></td>
                      <td className="small">{a.policy}</td>
                      <td>{c ? <Badge tone={OUTCOME_TONE[c.outcome]} square>{c.actual.finalState}</Badge> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Measured column: final state in validation cases S5–S0 (final rules). See the Validation page for latency.</p>
        </Card>
      </div>

      <Card title="Sources" icon={Radio} sub="Local demo sources are anvil test keys controlled by the team — not independent data providers. Weights are configured by governance, not measured."
        aside={<LiveTag kind="live" />}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Source</th><th style={{ minWidth: 150 }}>Weight</th><th className="r">Last price</th><th>Round</th><th>Age</th><th>Signature</th><th>Participation</th><th className="r">vs median</th><th className="r">vs <Term t="TWAP" /></th></tr>
            </thead>
            <tbody>
              {data.sources.map((s) => {
                const has = s.nonce > 0n
                const age = has ? Number(now - s.validAfter) : null
                const fresh = age !== null && age <= Number(v.maxAge)
                const w = totalWeight ? s.weight / totalWeight : 0
                const inRound = recorded && s.nonce === data.risk.weightedNonce
                const dm = has ? diff(s.price, v.price) : null
                return (
                  <tr key={s.address}>
                    <td><div style={{ display: 'grid' }}><b style={{ fontWeight: 500 }}>Source {s.index + 1}</b><span className="mono muted" title={s.address}>{shortHex(s.address)}</span></div></td>
                    <td><div style={{ display: 'grid', gap: 5 }}><span className="num small">{(w * 100).toFixed(0)}%</span><ProgressBar value={w / 0.3} tone="info" label={`Source ${s.index + 1} weight`} /></div></td>
                    <td className="r">{has ? usd(s.price) : '—'}</td>
                    <td className="mono">{has ? `#${String(s.nonce)}` : '—'}</td>
                    <td>{age === null ? <span className="muted">never</span> : <Badge tone={fresh ? 'ok' : 'watch'}>{fresh ? 'FRESH' : 'OLD'} · {duration(age)}</Badge>}</td>
                    <td>{!s.authorised ? <Badge tone="danger">NOT AUTHORISED</Badge> : has ? <Badge tone="ok" icon={BadgeCheck}>VERIFIED</Badge> : <span className="muted">—</span>}</td>
                    <td>{inRound ? <Badge tone="ok">IN LATEST ROUND</Badge> : has ? <Badge tone="neutral">EARLIER ROUND</Badge> : <Badge tone="neutral">NO RECORD</Badge>}</td>
                    <td className="r">{dm ? <span className={dm.bps >= 100 ? 'ink tone-disputed' : ''}>{dm.text}</span> : '—'}</td>
                    <td className="r">{has && data.snapshot.twapOk ? diff(s.price, data.snapshot.twap).text : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Per-source prices come from <span className="mono">ASORiskEngine.recordSources</span>, which re-verifies every signature against the verifier's EIP-712 digest and signer set. A round relayed with fewer signatures leaves the other sources' last values in place ("earlier round").</p>
      </Card>

      <div className={`callout tone-watch`}>
        <span className="ico"><ShieldAlert size={20} aria-hidden="true" /></span>
        <span className="t"><b>Cryptographic validity ≠ economic safety</b><span>A valid round proves authorized sources signed this price. It does not prove the underlying market is economically safe. If the underlying market is manipulated — or a majority of sources collude — the round is still valid. That is what the risk engine and Sentinel are for (validation cases V3–V5, A1).</span></span>
        <Badge tone="watch" caps square>Verifier ≠ safety</Badge>
      </div>
      <Note>Weighted median {recorded ? `${usd(data.risk.weightedMedian)} (${diff(data.risk.weightedMedian, v.price).text} vs median)` : 'not recorded for the latest round'} · divergence watch threshold {bps(d.thresholds.sourceDivBps)}.</Note>
    </>
  )
}
