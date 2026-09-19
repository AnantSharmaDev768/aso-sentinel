import { useState } from 'react'
import { Badge, StateBadge } from './components/ui'
import { RPC_URL } from './lib/chain'
import { duration } from './lib/format'
import { useOrigin } from './lib/useOrigin'
import { Overview } from './views/Overview'
import { OracleView } from './views/OracleView'
import { SentinelView } from './views/SentinelView'
import { CompareView } from './views/CompareView'
import { CostLab } from './views/CostLab'
import { ScenariosView } from './views/ScenariosView'
import { EvidenceView } from './views/EvidenceView'
import { PresentationView } from './views/PresentationView'

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'oracle', label: 'Oracle monitoring' },
  { id: 'sentinel', label: 'Sentinel state' },
  { id: 'compare', label: 'Baseline vs protected' },
  { id: 'lab', label: 'Manipulation Cost Lab' },
  { id: 'scenarios', label: 'Scenarios & log' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'present', label: 'Presentation mode' },
] as const
type ViewId = (typeof VIEWS)[number]['id']

export default function App() {
  const o = useOrigin()
  const [view, setView] = useState<ViewId>('overview')
  const ready = o.status === 'ready' && o.data

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mark">ORIGIN //</span>
          <span className="name">ASO Sentinel</span>
          <span className="muted" style={{ fontSize: 12 }}>Bounded-loss oracle protection</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {VIEWS.map((v) => (
            <button key={v.id} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>{v.label}</button>
          ))}
        </nav>
        <div className="foot">
          <span>Hackathon prototype. Not audited. Not integrated with Multipli.</span>
          <a href="https://github.com/AnantSharmaDev768/aso-sentinel" target="_blank" rel="noreferrer">Source code</a>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {ready ? <StateBadge state={o.data!.snapshot.state} /> : <Badge>{o.status === 'loading' ? 'Connecting…' : 'Not connected'}</Badge>}
          <Badge tone="gold" title="No wallet is used. Transactions are signed by anvil's public test accounts on your private local chain.">LOCAL DEMO MODE · no wallet</Badge>
          {ready && <span className="muted mono" style={{ fontSize: 12 }}>anvil 31337 · block {String(o.data!.chain.block)} · chain time +{duration(Number(o.data!.chain.timestamp) - 1_800_000_000)}</span>}
          <span className="spacer" />
          {o.busy && <Badge tone="watch">Running: {o.busy}</Badge>}
          <button className="btn small" disabled={!ready || !!o.busy} onClick={() => void o.refresh()}>Refresh</button>
          <button className="btn small" disabled={!ready || !!o.busy} onClick={() => void o.reset()} title="Rewind the local chain to the healthy snapshot">Reset chain</button>
        </header>

        <main className="content">
          {o.error && (
            <div className="banner error" role="alert">
              {o.error} <button className="btn small" style={{ marginLeft: 8 }} onClick={o.clearError}>Dismiss</button>
            </div>
          )}
          {o.status === 'loading' && <div className="center"><p className="muted">Connecting to the local chain…</p></div>}
          {o.status === 'no-deployment' && (
            <div className="center">
              <div className="card">
                <h2>No local deployment found</h2>
                <p className="t2">Start the local chain, deploy the contracts and bootstrap the demo state from the <span className="mono">app</span> folder:</p>
                <pre className="formula">npm run local</pre>
                <p className="muted" style={{ fontSize: 13 }}>It starts anvil on {RPC_URL}, runs <span className="mono">forge script DeployOrigin</span>, reaches the healthy FRESH state with real transactions, and serves this dashboard.</p>
                <button className="btn" onClick={() => void o.retry()}>Retry</button>
              </div>
            </div>
          )}
          {(o.status === 'no-chain' || o.status === 'wrong-network') && (
            <div className="center">
              <div className="card">
                <h2>{o.status === 'wrong-network' ? 'Wrong network' : 'Local chain not reachable'}</h2>
                <p className="t2">{o.statusDetail}</p>
                <p className="muted" style={{ fontSize: 13 }}>This dashboard only talks to a local anvil chain (chain id 31337). Restart it with <span className="mono">npm run local</span>.</p>
                <button className="btn" onClick={() => void o.retry()}>Retry</button>
              </div>
            </div>
          )}
          {ready && (
            <>
              {view === 'overview' && <Overview data={o.data!} />}
              {view === 'oracle' && <OracleView data={o.data!} />}
              {view === 'sentinel' && <SentinelView data={o.data!} />}
              {view === 'compare' && <CompareView data={o.data!} />}
              {view === 'lab' && <CostLab data={o.data!} quote={o.quote} run={o.run} busy={o.busy} />}
              {view === 'scenarios' && <ScenariosView run={o.run} busy={o.busy} log={o.log} />}
              {view === 'evidence' && <EvidenceView deployment={o.deployment} log={o.log} />}
              {view === 'present' && <PresentationView data={o.data!} run={o.run} busy={o.busy} reset={o.reset} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
