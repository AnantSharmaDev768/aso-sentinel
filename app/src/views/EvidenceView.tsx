import { BadgeCheck, Boxes, Calculator, ExternalLink, FileCheck2, Globe, HardDrive, ListChecks, ShieldAlert, TriangleAlert } from 'lucide-react'
import sepolia from '../../../deployments/11155111.json'
import run2 from '../../../deployments/11155111-scenarios-run2.json'
import { Addr, Badge, Card, EmptyState, LiveTag, PageHeader, TransactionItem } from '../components/ui'
import { useNow } from '../components/ui-helpers'
import type { OriginHook } from '../lib/useOrigin'
import { RESULTS, pct } from '../lib/validation'
import { BOUNDARIES } from '../lib/boundaries'

const SEPOLIA_CONTRACTS: [string, string, string][] = [
  ['ASOVerifier', 'verifier', 'ours'], ['ASOSentinel (v1 guard)', 'sentinel', 'ours'], ['Vat (protected)', 'protectedVat', 'multipli'], ['Vat (baseline)', 'baselineVat', 'multipli'],
  ['OSM', 'osm', 'multipli'], ['PriceFeedAdapter', 'adapter', 'multipli'], ['Spotter (protected)', 'protectedSpotter', 'multipli'], ['Spotter (baseline)', 'baselineSpotter', 'multipli'],
  ['GemJoin5 (protected)', 'protectedJoin', 'multipli'], ['GemJoin5 (baseline)', 'baselineJoin', 'multipli'], ['MockAggregator', 'feed', 'mock'], ['MockRWA', 'gem', 'mock'],
]
const KIND = { ours: { t: 'Prototype (ours)', tone: 'gold' }, multipli: { t: 'Multipli source, byte-identical', tone: 'info' }, mock: { t: 'Mock', tone: 'neutral' } } as const

interface RunRow { scenario: string; label: string; expect: string; actual: string; pass: boolean; txHash?: string; etherscanUrl?: string }


export function EvidenceView({ o }: { o: OriginHook }) {
  const now = useNow(1000)
  const sep = sepolia as Record<string, string | number>
  const rows = (run2 as RunRow[]).filter((r) => r.txHash)
  const local = [...o.log].reverse().filter((r) => !r.quiet || !r.pass)
  const f = RESULTS.final.main.summary
  const blockscout = (a: string) => `https://eth-sepolia.blockscout.com/address/${a}?tab=contract`

  return (
    <>
      <PageHeader title="Evidence Center" sub="Every result states where it came from. Local simulation, public-testnet transactions and modelled estimates are never mixed." tags={<><LiveTag kind="local" /><LiveTag kind="sepolia" /><LiveTag kind="modelled" /></>} />

      <div className="g12 stretch">
        <section className="ev-cat tone-gold s-4" aria-label="Local anvil evidence">
          <div className="ev-top"><span className="ev-ico"><HardDrive size={18} /></span><Badge tone="gold" caps square>Local anvil · 31337</Badge></div>
          <h3>Local simulation</h3>
          <span className="big">{local.length}</span>
          <p>transactions and checks in this session, plus the validation suite: {RESULTS.final.main.summary.total + RESULTS.final.holdout.summary.total} cases per rule set, {f.invariantChecks} invariant checks on the main suite. Private chain with time travel; addresses are disposable.</p>
        </section>
        <section className="ev-cat tone-neutral s-4" aria-label="Sepolia evidence">
          <div className="ev-top"><span className="ev-ico"><Globe size={18} /></span><Badge tone="neutral" caps square>Public testnet · Sepolia 11155111</Badge></div>
          <h3>Public testnet</h3>
          <span className="big">{SEPOLIA_CONTRACTS.length} · {rows.length}</span>
          <p>contracts source-verified on Sourcify (exact match) · linked transactions from the recorded run. <b>v1 core only</b> — the Origin modules are not deployed on Sepolia.</p>
        </section>
        <section className="ev-cat tone-info s-4" aria-label="Modelled evidence">
          <div className="ev-top"><span className="ev-ico"><Calculator size={18} /></span><Badge tone="info" caps square>Modelled</Badge></div>
          <h3>Assumption-based analytics</h3>
          <span className="big">cost gate</span>
          <p>Manipulation cost vs extractable value, computed on-chain from a governance depth assumption. An estimate, never a measurement of real liquidity.</p>
        </section>
      </div>

      <Card title="What is real, what is ours, what is simulated" icon={Boxes}>
        <div className="matrix">
          <div className="mx"><Badge tone="info" caps square>Verified Multipli code</Badge><ul><li>Vat, Spotter, OSM (+ ds-value/thing)</li><li>PriceFeedAdapter, GemJoin5</li><li>byte-identical to mainnet source</li></ul></div>
          <div className="mx"><Badge tone="gold" caps square>Prototype (ours)</Badge><ul><li>ASOVerifier, ASOSentinel (v1)</li><li>ASORiskEngine, OriginSentinel</li><li>CostModel, WeightedMedian, tests, demos</li></ul></div>
          <div className="mx"><Badge tone="neutral" caps square>Mocked / simulated</Badge><ul><li>5 price sources (test keys)</li><li>Chainlink-style feed, collateral token</li><li>time (anvil), keeper, market depth</li></ul></div>
          <div className="mx"><Badge tone="danger" caps square>Not done</Badge><ul><li>Multipli integration (vat.rely)</li><li>independent real sources, audit</li><li>Origin on Sepolia, keeper incentives</li><li>liquidations, collateral-withdrawal gating</li></ul></div>
        </div>
      </Card>

      <Card title="Sepolia deployment — v1 core" icon={Globe} sub="Chain 11155111. Source verification (Sourcify, exact match) shows the bytecode matches this repository; it is not a security audit." aside={<LiveTag kind="sepolia" />}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Contract</th><th>Address</th><th>Kind</th><th>Verification</th><th>Explorer</th></tr></thead>
            <tbody>
              {SEPOLIA_CONTRACTS.map(([name, key, kind]) => (
                <tr key={key}>
                  <td>{name}</td>
                  <td><Addr address={String(sep[key])} /></td>
                  <td><Badge tone={KIND[kind as keyof typeof KIND].tone} square>{KIND[kind as keyof typeof KIND].t}</Badge></td>
                  <td><Badge tone="ok" icon={BadgeCheck} caps square>Source verified · exact match</Badge></td>
                  <td><a href={blockscout(String(sep[key]))} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>Blockscout <ExternalLink size={12} /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Sepolia run 2 — ${(run2 as RunRow[]).filter((r) => r.pass).length}/${(run2 as RunRow[]).length} checks`} icon={FileCheck2} sub="Recorded by demo/run-sepolia.mjs; every linked transaction was re-checked against the chain (docs/SEPOLIA.md). Run 1's raw file was overwritten; its transactions are linked in docs/SEPOLIA.md." aside={<LiveTag kind="sepolia" />}>
        <div className="table-wrap scroll-y" style={{ maxHeight: 420 }}>
          <table className="table">
            <thead><tr><th>Scenario</th><th>Step</th><th>Result</th><th>Transaction</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.txHash}>
                  <td className="mono">{r.scenario}</td>
                  <td>{r.label}</td>
                  <td>{r.pass ? <Badge tone={r.actual.startsWith('success') ? 'ok' : 'watch'} square caps>{r.actual.startsWith('success') ? 'Confirmed' : 'Reverted as expected'}</Badge> : <Badge tone="danger">{r.actual}</Badge>}</td>
                  <td>{r.etherscanUrl ? <a className="mono row" style={{ gap: 4 }} href={r.etherscanUrl} target="_blank" rel="noreferrer">{`${r.txHash!.slice(0, 10)}…${r.txHash!.slice(-6)}`}<ExternalLink size={12} /></a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="g12">
        <Card className="s-6" title="Validation evidence" icon={ListChecks} sub="Generated result files — local anvil, synthetic prices" aside={<LiveTag kind="local" />}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>N</th><th>Recall</th><th>Precision</th><th>FP rate</th></tr></thead>
              <tbody>
                {(['baseline', 'candidate', 'final'] as const).flatMap((rs) => (['main', 'holdout'] as const).map((su) => {
                  const r = RESULTS[rs][su]
                  return <tr key={`${rs}${su}`}><td className="mono small">validation/{rs === 'candidate' ? 'candidate-graded' : rs}/{su}.json</td><td>{r.summary.total}</td><td>{pct(r.summary.recall)}</td><td>{pct(r.summary.precision)}</td><td>{pct(r.summary.falsePositiveRate)}</td></tr>
                }))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Reproduce with <span className="mono">cd demo &amp;&amp; npm run validate</span> (final) and <span className="mono">-- --rules=baseline</span>. Report: docs/VALIDATION.md.</p>
        </Card>
        <Card className="s-6" title="This session" icon={HardDrive} sub="Transactions sent from this dashboard to the local chain" aside={<LiveTag kind="local" />}>
          {local.length === 0 ? <EmptyState icon={HardDrive} title="No local transactions recorded in this session">Run a scenario or the presentation to record live on-chain activity.</EmptyState> : (
            <div className="scroll-y" style={{ maxHeight: 360 }}><ol className="timeline">{local.slice(0, 40).map((r) => <TransactionItem key={r.id} rec={r} now={now} />)}</ol></div>
          )}
        </Card>
      </div>

      <Card title="Known detection boundaries" icon={ShieldAlert} sub="What Origin does not claim to protect against. These are limits of scope, not hidden failures: the goal is bounded loss, not guaranteed safety.">
        <div className="g12" style={{ gap: 12 }}>
          {BOUNDARIES.map((b, i) => (
            <div key={b.t} className="s-4 inc" style={{ gap: 6 }}>
              <span className="row"><Badge tone="watch" square>{i + 1}</Badge><b style={{ fontSize: 14 }}>{b.t}</b></span>
              <p>{b.d}</p>
            </div>
          ))}
        </div>
        <p className="small t2"><TriangleAlert size={13} style={{ verticalAlign: '-2px' }} /> Origin does claim, and tests: invalid data is rejected; disagreement freezes; large or fast moves restrict borrowing even when every source agrees; restricted states never create new debt; repayments always work; recovery requires a newer round and a delay; daily debt growth is capped.</p>
      </Card>
    </>
  )
}
