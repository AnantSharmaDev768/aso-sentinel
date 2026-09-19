import { Ban, CheckCircle2, FlaskConical, Scale, Shield, ShieldOff, Wallet } from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN } from '../../../shared/origin-core.mjs'
import { Badge, Card, LiveTag, Note, PageHeader, StatusBadge, Term } from '../components/ui'
import { CompareBars } from '../components/viz'
import { badDebt } from '../lib/derive'
import { RAY, ratio, rwa, toNumber, usd, usdCompact } from '../lib/format'
import { STATE_INFO } from '../lib/risk'
import { caseById } from '../lib/validation'

const EVIDENCE = ['A1', 'A2', 'V3', 'V5', 'F1', 'M2']

export function CompareView({ data }: { data: OriginReadout }) {
  const s = data.snapshot
  const b = data.baseline
  const p = data.protectedVat
  const baseVatPrice = b.spot === 0n ? 0n : (((b.spot * data.matRay) / RAY) / 10n ** 9n)
  const fair = s.attestedPrice
  const names = ['alice', 'bob', 'mallory'] as const
  const exposure = (w: 'baseline' | 'protected') => names.reduce((acc, n) => acc + badDebt(data.urns[n][w], w === 'baseline' ? b.rate : p.rate, fair), 0n)
  const bRoom = b.line > b.debt ? b.line - b.debt : 0n
  const pRoom = p.line > p.debt ? p.line - p.debt : 0n
  const tone = STATE_INFO[s.state].tone

  const panel = (which: 'baseline' | 'protected') => {
    const isB = which === 'baseline'
    return (
      <section className={`side-panel tone-${isB ? 'neutral' : tone}`} aria-label={isB ? 'Baseline market' : 'Protected market'}>
        <div className="sp-head">
          <span className="eyebrow">{isB ? 'Baseline' : 'Protected'}</span>
          <h2 className="row">{isB ? <ShieldOff size={18} aria-hidden="true" /> : <Shield size={18} aria-hidden="true" />}{isB ? 'No Sentinel' : 'Origin // ASO Sentinel'}</h2>
          <div>{isB ? <Badge tone="neutral">Multipli contracts alone</Badge> : <StatusBadge state={s.state} />}</div>
        </div>
        <div className="metrics">
          <div className="metric"><span className="m-label">Debt</span><span className="m-value sm">{rwa(isB ? b.debt : p.debt).replace(' rwaUSD', '')}</span><span className="m-sub">rwaUSD</span></div>
          <div className="metric"><span className="m-label"><Term t="Debt ceiling">Debt ceiling</Term></span><span className="m-value sm">{rwa(isB ? b.line : p.line).replace(' rwaUSD', '')}</span><span className="m-sub">rwaUSD</span></div>
          <div className="metric"><span className="m-label"><Term t="Headroom">Borrowing headroom</Term></span><span className={`m-value ${!isB && pRoom === 0n ? 'ink tone-danger' : ''}`}>{rwa(isB ? bRoom : pRoom).replace(' rwaUSD', '')}</span><span className="m-sub">new debt allowed now</span></div>
          <div className="metric"><span className="m-label">Vat lends at</span><span className="m-value sm">{usd(isB ? baseVatPrice : s.vatPrice)}</span><span className="m-sub">same Multipli OSM price</span></div>
          <div className="metric"><span className="m-label"><Term t="Effective price" /></span><span className="m-value sm">{isB ? '—' : usd(s.effectivePrice)}</span><span className="m-sub">{isB ? 'no risk layer: not used' : 'min(attested, TWAP) — used by the risk checks'}</span></div>
          <div className="metric"><span className="m-label">Extractable value</span><span className="m-value sm">{usdCompact(isB ? b.costBest.extractableUsd : s.costQuote.extractableUsd)}</span><span className="m-sub">modelled, same depth assumption</span></div>
          <div className="metric"><span className="m-label"><Term t="Cost / extractable" /></span><span className="m-value sm">{ratio(isB ? b.costBest.ratioBps : s.costQuote.ratioBps)}</span><span className="m-sub">{CONCERN[isB ? b.concern : s.concern]}</span></div>
          <div className="metric"><span className="m-label">New borrowing</span><span className={`m-value sm ink tone-${isB ? 'neutral' : tone}`}>{isB ? 'ALWAYS OPEN' : STATE_INFO[s.state].borrowing.toUpperCase()}</span><span className="m-sub">{isB ? 'no oracle-risk control' : STATE_INFO[s.state].effect}</span></div>
          <div className="metric"><span className="m-label">Repayment</span><span className="m-value sm ink tone-ok">AVAILABLE</span><span className="m-sub">in every state</span></div>
        </div>
      </section>
    )
  }

  return (
    <>
      <PageHeader title="Baseline vs Protected" sub="Two copies of Multipli's own contracts (Vat, Spotter, OSM, adapter) fed by the same price feed. The only difference: OriginSentinel controls the protected Vat's debt ceiling."
        tags={<LiveTag kind="live" />} />

      <div className="callout tone-gold">
        <span className="ico"><Shield size={20} aria-hidden="true" /></span>
        <span className="t"><b>Same lending logic, same price path</b><span>The protected market does not change the price. It changes how much NEW debt the system is willing to create under risk. Repayments work in both.</span></span>
        <span />
      </div>

      <div className="split">
        {panel('baseline')}
        <span className="vs" aria-hidden="true">VS</span>
        {panel('protected')}
      </div>

      <div className="g12">
        <Card className="s-7" title="New debt that can be created right now" icon={Scale} aside={<LiveTag kind="live" />}>
          <CompareBars rows={[
            { label: 'Baseline headroom', value: toNumber(bRoom, 45), text: rwa(bRoom), tone: 'neutral' },
            { label: 'Protected headroom', value: toNumber(pRoom, 45), text: rwa(pRoom), tone: pRoom === 0n ? 'danger' : s.state === 1 ? 'watch' : 'ok' },
            { label: 'Baseline modelled extractable value', value: toNumber(b.costBest.extractableUsd, 18), text: usdCompact(b.costBest.extractableUsd), tone: 'neutral' },
            { label: 'Protected modelled extractable value', value: toNumber(s.costQuote.extractableUsd, 18), text: usdCompact(s.costQuote.extractableUsd), tone: 'info' },
          ]} />
          <p className="muted small">Headroom = debt ceiling − debt, read from both Vats. Extractable value uses the same governance depth assumption for both; it is a model, not a measurement.</p>
        </Card>
        <Card className="s-5" title="Bad-debt estimate at the current price" icon={Wallet} aside={<LiveTag kind="estimate" />}>
          <CompareBars rows={[
            { label: 'Baseline', value: toNumber(exposure('baseline'), 18), text: usd(exposure('baseline')), tone: 'danger' },
            { label: 'Protected', value: toNumber(exposure('protected'), 18), text: usd(exposure('protected')), tone: 'ok' },
          ]} />
          <p className="muted small">Sum over the demo vaults of debt above collateral value at the latest attested price. A browser estimate — no liquidation module is deployed. Run scenario A or D to see the gap open up.</p>
        </Card>
      </div>

      <Card title="Attack evidence: the same borrow, on both markets" icon={FlaskConical} sub="From the validation run: after each attack the harness probed (eth_call) whether a 1,000 rwaUSD borrow would succeed on each Vat." aside={<LiveTag kind="local" />}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Case</th><th>Attack</th><th>Sentinel state</th><th>Baseline borrow</th><th>Protected borrow</th><th>Repayment (protected)</th></tr></thead>
            <tbody>
              {EVIDENCE.map((id) => {
                const c = caseById(id)
                if (!c) return null
                const ok = (v: boolean | null) => v == null ? '—' : v ? <Badge tone="watch" icon={CheckCircle2}>succeeds</Badge> : <Badge tone="ok" icon={Ban}>reverts</Badge>
                return (
                  <tr key={id}>
                    <td className="mono">{id}</td>
                    <td>{c.title}</td>
                    <td><Badge tone={c.actual.finalState === 'FRESH' ? 'ok' : c.actual.finalState === 'WATCH' ? 'watch' : c.actual.finalState === 'DISPUTED' ? 'disputed' : 'danger'} square>{c.actual.finalState}</Badge></td>
                    <td>{ok(c.actual.baselineBorrowFinal)}</td>
                    <td>{ok(c.actual.borrowProbeFinal)}</td>
                    <td>{c.actual.repayProbeFinal ? <Badge tone="ok" icon={CheckCircle2}>succeeds</Badge> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Note>"Baseline borrow succeeds" means the unprotected market keeps lending at the OSM price during the attack; on the protected market the Vat itself reverts with <span className="mono">Vat/ceiling-exceeded</span>. Run scenario A on the Scenarios page to reproduce it with mined transactions.</Note>
      </Card>

      <Card title="Demo vaults" icon={Wallet} sub="Simulated actors on the local chain; collateral valued at the latest attested price">
        <div className="vaults">
          {names.map((n) => {
            const u = data.urns[n]
            const bb = badDebt(u.baseline, b.rate, fair)
            const pb = badDebt(u.protected, p.rate, fair)
            const col = (label: string, ink: bigint, art: bigint, rate: bigint, bad: bigint) => (
              <div className="col">
                <span className="eyebrow">{label}</span>
                <span className="s">Collateral</span><span className="v">{usd((ink * fair) / 10n ** 18n)}</span>
                <span className="s">Debt</span><span className="v">{rwa(art * rate)}</span>
                {bad > 0n ? <Badge tone="danger">under-collateralised {usd(bad)}</Badge> : <Badge tone="ok">covered</Badge>}
              </div>
            )
            return (
              <div className="vault" key={n}>
                <div className="vh"><h3>{n}</h3><span className="muted small">{u.baseline.ink + u.protected.ink === 0n ? 'no position' : 'demo account'}</span></div>
                <div className="cols">{col('Baseline', u.baseline.ink, u.baseline.art, b.rate, bb)}{col('Protected', u.protected.ink, u.protected.art, p.rate, pb)}</div>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}
