import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Blocks, Clock, Code2, Columns2, FlaskConical, FolderCheck, LayoutDashboard, ListChecks, Menu, MonitorPlay, PlugZap, Radio, RefreshCw, RotateCcw,
  Shield, TriangleAlert, Unplug, X, type LucideIcon,
} from 'lucide-react'
import { Alert, LoadingState, Spinner, StatusBadge } from './components/ui'
import { RPC_URL, simTime } from './lib/chain'
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
import { ValidationView } from './views/ValidationView'

export type ViewId = 'overview' | 'oracle' | 'sentinel' | 'compare' | 'lab' | 'scenarios' | 'validation' | 'evidence' | 'present'

const NAV: { group: string; items: { id: ViewId; label: string; icon: LucideIcon }[] }[] = [
  { group: 'Monitor', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'oracle', label: 'Oracle Monitoring', icon: Radio },
    { id: 'sentinel', label: 'Sentinel State', icon: Shield },
  ] },
  { group: 'Analysis', items: [
    { id: 'compare', label: 'Baseline vs Protected', icon: Columns2 },
    { id: 'lab', label: 'Manipulation Cost Lab', icon: FlaskConical },
    { id: 'scenarios', label: 'Scenarios & Log', icon: Blocks },
  ] },
  { group: 'Proof', items: [
    { id: 'validation', label: 'Validation', icon: ListChecks },
    { id: 'evidence', label: 'Evidence', icon: FolderCheck },
    { id: 'present', label: 'Presentation Mode', icon: MonitorPlay },
  ] },
]

export default function App() {
  const o = useOrigin()
  const [view, setView] = useState<ViewId>('overview')
  const [navOpen, setNavOpen] = useState(false)
  const [dismissedFail, setDismissedFail] = useState(0)
  const ready = o.status === 'ready' && o.data !== null

  const go = (v: ViewId) => {
    setView(v)
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    if (!navOpen) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false)
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [navOpen])

  // A mined outcome that did not match what the scenario expected is surfaced, never hidden in the log.
  const lastFail = useMemo(() => [...o.log].reverse().find((r) => !r.pass), [o.log])
  const showFail = lastFail && lastFail.id > dismissedFail

  const title = NAV.flatMap((g) => g.items).find((i) => i.id === view)?.label
  useEffect(() => { document.title = `${title} · Origin // ASO Sentinel` }, [title])

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a href="#main" className="sr-only">Skip to content</a>
      <aside className="side" aria-label="Primary">
        <div className="brand">
          <span className="mark"><Shield size={14} aria-hidden="true" />ORIGIN //</span>
          <span className="name">ASO Sentinel</span>
          <span className="sub">Bounded-loss oracle protection</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group} role="group" aria-label={g.group}>
              <span className="eyebrow" aria-hidden="true">{g.group}</span>
              {g.items.map((it) => (
                <button key={it.id} className="nav-item" aria-current={view === it.id ? 'page' : undefined} onClick={() => go(it.id)}>
                  <it.icon size={16} aria-hidden="true" />{it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span className="eyebrow">Prototype status</span>
          <ul>
            <li><BadgeCheck size={13} aria-hidden="true" />Hackathon prototype</li>
            <li><TriangleAlert size={13} aria-hidden="true" />Not audited</li>
            <li><Unplug size={13} aria-hidden="true" />Not integrated with Multipli</li>
          </ul>
          <a href="https://github.com/AnantSharmaDev768/aso-sentinel" target="_blank" rel="noreferrer"><Code2 size={13} aria-hidden="true" />View source</a>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <div className="grp">
            <button className="icon-btn menu-btn" aria-label={navOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
              {navOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
            {ready ? <StatusBadge state={o.data!.snapshot.state} animate /> : <span className="status tone-neutral">{o.status === 'loading' ? <Spinner /> : <PlugZap size={14} />}{o.status === 'loading' ? 'CONNECTING' : 'OFFLINE'}</span>}
            <span className="demo-chip" title="No wallet is used. Transactions are signed by anvil's public test accounts on your private local chain.">Local demo mode</span>
          </div>
          {ready && (
            <div className="netinfo" aria-label="Network status">
              <span className="ink tone-ok"><span className="live-tag live tone-ok" style={{ gap: 0 }}><span className="pulse" aria-hidden="true" /></span>Anvil local</span>
              <span className="hide-sm">Chain ID 31337</span>
              <span><Blocks size={13} aria-hidden="true" />Block #{String(o.data!.chain.block)}</span>
              <span className="hide-sm" title="Chain time relative to the local chain's start; scenarios fast-forward it."><Clock size={13} aria-hidden="true" />{simTime(o.data!.chain.timestamp, duration)} simulated</span>
            </div>
          )}
          <span className="spacer" />
          <div className="grp">
            {o.busy && <span className="loading small" role="status"><Spinner />{o.busy === 'Reset' ? 'Resetting…' : 'Running…'}</span>}
            <button className="btn sm" disabled={!ready || !!o.busy} onClick={() => void o.refresh()}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
            <button className="btn sm" disabled={!ready || !!o.busy} onClick={() => void o.reset()} title="Rewind the local chain to the healthy snapshot taken at start-up">
              <RotateCcw size={14} aria-hidden="true" />Reset chain
            </button>
          </div>
        </header>

        <main className="content" id="main" key={ready ? view : o.status}>
          {o.error && <Alert title={o.error.title} message={o.error.message} reason={o.error.reason} detail={o.error.detail} onDismiss={o.clearError} />}
          {showFail && (
            <Alert
              title="Unexpected on-chain outcome"
              message={`${lastFail.label}: expected ${lastFail.expect ?? 'the check to pass'}${lastFail.expectReason ? ` (${lastFail.expectReason})` : ''}.`}
              reason={lastFail.reason ?? lastFail.actual ?? lastFail.status}
              onDismiss={() => setDismissedFail(lastFail.id)}
            />
          )}

          {o.status === 'loading' && <div className="center"><LoadingState>Reading contract state…</LoadingState></div>}
          {o.status === 'no-deployment' && (
            <div className="center">
              <div className="card">
                <h2>No local deployment found</h2>
                <p className="t2">Start the local chain, deploy the contracts and bootstrap the demo state from the <span className="mono">app</span> folder:</p>
                <pre className="formula">npm run local</pre>
                <p className="muted small">It starts anvil on {RPC_URL}, runs <span className="mono">forge script DeployOrigin</span>, reaches the healthy FRESH state with real transactions, and serves this dashboard.</p>
                <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => void o.retry()}><RefreshCw size={14} />Retry</button>
              </div>
            </div>
          )}
          {(o.status === 'no-chain' || o.status === 'wrong-network') && (
            <div className="center">
              <div className="card">
                <h2>{o.status === 'wrong-network' ? 'Network mismatch' : 'Local chain not reachable'}</h2>
                <p className="t2">{o.statusDetail}</p>
                <p className="muted small">This dashboard only talks to a local anvil chain (chain id 31337) and never sends transactions elsewhere. Restart it with <span className="mono">npm run local</span>.</p>
                <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => void o.retry()}><RefreshCw size={14} />Retry</button>
              </div>
            </div>
          )}
          {ready && (
            <>
              {view === 'overview' && <Overview o={o} data={o.data!} go={go} />}
              {view === 'oracle' && <OracleView o={o} data={o.data!} />}
              {view === 'sentinel' && <SentinelView o={o} data={o.data!} />}
              {view === 'compare' && <CompareView data={o.data!} />}
              {view === 'lab' && <CostLab o={o} data={o.data!} />}
              {view === 'scenarios' && <ScenariosView o={o} />}
              {view === 'validation' && <ValidationView o={o} />}
              {view === 'evidence' && <EvidenceView o={o} />}
              {view === 'present' && <PresentationView o={o} data={o.data!} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
