import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { VERIFIER_STATUS } from '../../../shared/origin-core.mjs'
import { Badge, Card, Stat } from '../components/ui'
import { PriceChart } from '../components/PriceChart'
import { bps, duration, shortHex, usd } from '../lib/format'

function diffBps(a: bigint, b: bigint): string {
  if (a === 0n || b === 0n) return '—'
  const d = a > b ? a - b : b - a
  return `${a >= b ? '+' : '−'}${bps((d * 10_000n) / b)}`
}

export function OracleView({ data }: { data: OriginReadout }) {
  const v = data.verifier
  const now = data.chain.timestamp
  const totalWeight = data.sources.reduce((a, s) => a + s.weight, 0)
  const recordedLatest = data.risk.weightedNonce !== 0n && data.risk.weightedNonce === v.lastAcceptedNonce
  const tone = v.status === 1 ? 'ok' : v.status === 3 ? 'disputed' : 'danger'
  return (
    <>
      <div className="grid g4">
        <Card className="tight"><Stat label="Verifier status" value={<Badge tone={tone}>{VERIFIER_STATUS[v.status]}</Badge>} sub={`quorum ${String(v.quorum)} of ${data.sources.length} · strict majority`} /></Card>
        <Card className="tight"><Stat label="Last accepted round" value={`#${String(v.lastAcceptedNonce)}`} sub={`last round consumed #${String(v.lastNonce)}${v.lastNonce !== v.lastAcceptedNonce ? ' (disputed)' : ''}`} /></Card>
        <Card className="tight"><Stat label="Median / weighted median" value={usd(v.price)} sub={recordedLatest ? `weighted ${usd(data.risk.weightedMedian)} (${diffBps(data.risk.weightedMedian, v.price)})` : 'no per-source record for this round'} /></Card>
        <Card className="tight"><Stat label="Expires" value={now > v.expiresAt ? 'expired' : `in ${duration(v.expiresAt - now)}`} sub={`observed ${duration(now - v.observedAt)} ago`} tone={now > v.expiresAt ? 'danger' : undefined} /></Card>
      </div>

      <Card title="Sources" sub="Five EIP-712 signers. Local demo keys are anvil test accounts; weights are configured reliability/liquidity weights (an assumption, not measured liquidity).">
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr><th>Source</th><th>Address</th><th className="r">Weight</th><th className="r">Last price</th><th>Round</th><th>Freshness</th><th>Signature</th><th className="r">vs median</th><th className="r">vs TWAP</th></tr>
            </thead>
            <tbody>
              {data.sources.map((s) => {
                const has = s.nonce > 0n
                const age = has ? Number(now - s.validAfter) : null
                const fresh = age !== null && age <= Number(v.maxAge)
                return (
                  <tr key={s.address}>
                    <td>Source {s.index + 1}</td>
                    <td className="mono">{shortHex(s.address)}</td>
                    <td className="r">{s.weight} <span className="muted">({totalWeight ? ((s.weight / totalWeight) * 100).toFixed(0) : 0}%)</span></td>
                    <td className="r">{has ? usd(s.price) : '—'}</td>
                    <td className="mono">{has ? `#${String(s.nonce)}` : '—'}</td>
                    <td>{age === null ? <span className="muted">never recorded</span> : <Badge tone={fresh ? 'ok' : 'watch'}>{fresh ? 'fresh' : 'old'} · {duration(age)}</Badge>}</td>
                    <td>{!s.authorised ? <Badge tone="danger">not authorised</Badge> : has ? <Badge tone="ok">verified on-chain</Badge> : <span className="muted">—</span>}</td>
                    <td className="r">{has ? diffBps(s.price, v.price) : '—'}</td>
                    <td className="r">{has && data.snapshot.twapOk ? diffBps(s.price, data.snapshot.twap) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Per-source prices come from <span className="mono">ASORiskEngine.recordSources</span>, which re-verifies every signature against the
          verifier's EIP-712 digest and signer set. A round relayed with only three signatures shows the other sources' last recorded values.
        </p>
      </Card>

      <Card title="Accepted rounds" sub="Only rounds the verifier ACCEPTED enter the history (disputed rounds do not move the price).">
        <PriceChart observations={data.risk.observations} twap={data.snapshot.twap} twapOk={data.snapshot.twapOk} now={now} />
      </Card>
    </>
  )
}
