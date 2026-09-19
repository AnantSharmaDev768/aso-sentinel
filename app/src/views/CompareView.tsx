import type { ReactNode } from 'react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN } from '../../../shared/origin-core.mjs'
import { Badge, Card, StateBadge } from '../components/ui'
import { badDebt } from '../lib/derive'
import { RAY, ratio, rwa, usd, usdCompact } from '../lib/format'

export function CompareView({ data }: { data: OriginReadout }) {
  const s = data.snapshot
  const b = data.baseline
  const p = data.protectedVat
  const baselineVatPrice = b.spot === 0n ? 0n : (((b.spot * data.matRay) / RAY) / 10n ** 9n)
  const fair = s.attestedPrice // valuation for the bad-debt estimate: latest attested median
  const names = ['alice', 'bob', 'mallory'] as const
  const exposure = (which: 'baseline' | 'protected') => names.reduce((acc, n) => acc + badDebt(data.urns[n][which], which === 'baseline' ? b.rate : p.rate, fair), 0n)
  const rows: [string, ReactNode, ReactNode, string?][] = [
    ['Guard', <span key="b" className="muted">none (Multipli contracts alone)</span>, <StateBadge key="p" state={s.state} />],
    ['Vat lends at', usd(baselineVatPrice), usd(s.vatPrice), 'Both read the same Multipli OSM.'],
    ['Attested / effective price', usd(s.attestedPrice), `${usd(s.attestedPrice)} / ${usd(s.effectivePrice)}`, 'The baseline has no attestation check at all; shown for reference.'],
    ['Debt', rwa(b.debt), rwa(p.debt)],
    ['Debt ceiling', rwa(b.line), rwa(p.line)],
    ['Borrowing capacity (ceiling − debt)', rwa(b.line > b.debt ? b.line - b.debt : 0n), rwa(p.line > p.debt ? p.line - p.debt : 0n)],
    ['Extractable value (cost gate, same depth assumption)', usdCompact(b.costBest.extractableUsd), usdCompact(s.costQuote.extractableUsd), 'Bounded by each market’s headroom.'],
    ['Cost ÷ extractable', `${ratio(b.costBest.ratioBps)} · ${CONCERN[b.concern]}`, `${ratio(s.costQuote.ratioBps)} · ${CONCERN[s.concern]}`],
    ['Bad-debt estimate at the attested price', usd(exposure('baseline')), usd(exposure('protected')), 'Sum over demo vaults of debt above collateral value at the latest attested median. An estimate — no liquidation module is deployed.'],
  ]
  return (
    <>
      <Card title="Baseline vs protected" sub="Same Multipli code (Vat, Spotter, OSM, adapter), same price feed. The only difference is OriginSentinel on the protected Vat.">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Measure</th><th>Baseline</th><th>Protected</th><th>Note</th></tr></thead>
            <tbody>{rows.map(([k, a, c, n]) => <tr key={k}><td className="t2">{k}</td><td className="num">{a}</td><td className="num">{c}</td><td className="muted" style={{ fontSize: 12.5 }}>{n ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Demo vaults" sub="Collateral valued at the latest attested price (simulated demo actors on the local chain)">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Vault</th><th className="r">Baseline collateral</th><th className="r">Baseline debt</th><th className="r">Protected collateral</th><th className="r">Protected debt</th><th>Status</th></tr></thead>
            <tbody>
              {names.map((n) => {
                const u = data.urns[n]
                const bb = badDebt(u.baseline, b.rate, fair)
                return (
                  <tr key={n}>
                    <td style={{ textTransform: 'capitalize' }}>{n}</td>
                    <td className="r">{usd((u.baseline.ink * fair) / 10n ** 18n)}</td>
                    <td className="r">{rwa(u.baseline.art * b.rate)}</td>
                    <td className="r">{usd((u.protected.ink * fair) / 10n ** 18n)}</td>
                    <td className="r">{rwa(u.protected.art * p.rate)}</td>
                    <td>{bb > 0n ? <Badge tone="danger">baseline under-collateralised: {usd(bb)}</Badge> : <span className="muted">covered</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
