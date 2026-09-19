import sepolia from '../../../deployments/11155111.json'
import run2 from '../../../deployments/11155111-scenarios-run2.json'
import { Badge, Card, Empty, TxRow } from '../components/ui'
import { shortHex } from '../lib/format'
import type { LocalDeployment } from '../lib/chain'
import type { LoggedRecord } from '../lib/useOrigin'

const SEPOLIA_CONTRACTS: [string, string][] = [
  ['ASOVerifier', 'verifier'], ['ASOSentinel (v1 core guard)', 'sentinel'], ['Vat (protected)', 'protectedVat'], ['Vat (baseline)', 'baselineVat'],
  ['OSM', 'osm'], ['PriceFeedAdapter', 'adapter'], ['Spotter (protected)', 'protectedSpotter'], ['Spotter (baseline)', 'baselineSpotter'],
  ['GemJoin5 (protected)', 'protectedJoin'], ['GemJoin5 (baseline)', 'baselineJoin'], ['MockAggregator (mock feed)', 'feed'], ['MockRWA (mock token)', 'gem'],
]

interface RunRow { scenario: string; label: string; expect: string; actual: string; pass: boolean; txHash?: string; etherscanUrl?: string }

export function EvidenceView({ deployment, log }: { deployment: LocalDeployment | null; log: LoggedRecord[] }) {
  const sep = sepolia as Record<string, string | number>
  const rows = run2 as RunRow[]
  const txs = rows.filter((r) => r.txHash)
  return (
    <>
      <p className="banner warn">
        Three kinds of evidence, never mixed: <b>LOCAL</b> transactions from this dashboard (private anvil chain, disposable),
        <b> SEPOLIA</b> public-testnet transactions of the <b>v1 core</b> (ASOVerifier + ASOSentinel), and <b>SIMULATED</b> analytics
        (cost-gate estimates from assumptions). The Origin modules (ASORiskEngine, OriginSentinel) are <b>not deployed on Sepolia</b>.
      </p>

      <Card title="Sepolia testnet — v1 core deployment" sub="Chain 11155111. All 12 contracts source-verified on Sourcify (exact match); source verification is not a security audit."
        right={<Badge tone="gold">SEPOLIA · public testnet</Badge>}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Contract</th><th>Address (Blockscout, verified source)</th></tr></thead>
            <tbody>
              {SEPOLIA_CONTRACTS.map(([name, key]) => (
                <tr key={key}><td>{name}</td><td><a className="mono" href={`https://eth-sepolia.blockscout.com/address/${sep[key]}?tab=contract`} target="_blank" rel="noreferrer">{String(sep[key])}</a></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Sepolia run 2 — 27/27 checks" sub="Recorded by demo/run-sepolia.mjs; every linked transaction was re-checked against the chain (docs/SEPOLIA.md)." right={<Badge tone="gold">SEPOLIA</Badge>}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Scenario</th><th>Step</th><th>Actual</th><th>Transaction</th></tr></thead>
            <tbody>
              {txs.map((r) => (
                <tr key={r.txHash}>
                  <td className="mono">{r.scenario}</td>
                  <td>{r.label}</td>
                  <td>{r.pass ? <Badge tone={r.actual.startsWith('success') ? 'ok' : 'watch'} dot={false}>{r.actual.slice(0, 44)}</Badge> : <Badge tone="danger">{r.actual}</Badge>}</td>
                  <td><a className="mono" href={r.etherscanUrl} target="_blank" rel="noreferrer">{shortHex(r.txHash ?? '', 8, 6)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Local session" sub={deployment ? `Local anvil (31337) deployment of ${deployment.deployedAt}. OriginSentinel ${String(deployment.sentinel)} — local addresses change on every restart.` : 'No local deployment loaded.'}
        right={<Badge tone="muted">LOCAL · anvil</Badge>}>
        <div className="log">
          {log.length === 0 ? <Empty>No local transactions in this session yet.</Empty> : [...log].reverse().filter((r) => !r.quiet || !r.pass).map((r) => <TxRow key={r.id} rec={r} />)}
        </div>
      </Card>
    </>
  )
}
