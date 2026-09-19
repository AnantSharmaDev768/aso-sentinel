import { useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, CircleAlert, Play, Target } from 'lucide-react'
import { SCENARIOS, STATE } from '../../../shared/origin-core.mjs'
import { Badge, EmptyState, LiveTag, PageHeader, Spinner, TransactionItem, type Tone } from '../components/ui'
import { useNow } from '../components/ui-helpers'
import type { OriginHook } from '../lib/useOrigin'
import { caseById, OUTCOME_TEXT, OUTCOME_TONE } from '../lib/validation'
import { useLiveCase } from '../lib/liveCase'

const META: Record<string, { letter: string; truth: 'ATTACK' | 'HEALTHY' | 'FAILURE'; trigger: string; expected: string; borrow: { baseline: string; protected: string }; reason: string; cases: string[] }> = {
  attacks: { letter: '∅', truth: 'ATTACK', trigger: 'forged, outsider, duplicated and replayed rounds', expected: 'unchanged — every bad round is rejected', borrow: { baseline: '—', protected: 'unchanged (no bad price accepted)' }, reason: 'InvalidSignature · UnauthorizedSigner · SignersNotStrictlyAscending · NonceNotIncreasing', cases: ['I1', 'I2', 'I5', 'I3'] },
  A: { letter: 'A', truth: 'ATTACK', trigger: '+60% manipulated market, all sources agree', expected: 'PROTECTIVE', borrow: { baseline: 'borrow succeeds', protected: 'borrow reverts (Vat/ceiling-exceeded)' }, reason: 'TWAP deviation ≥ 15% and velocity ≥ 20%/h, although every signature is valid', cases: ['A1'] },
  B: { letter: 'B', truth: 'ATTACK', trigger: '+60% held longer than the TWAP window', expected: 'PROTECTIVE, then WATCH (bounded)', borrow: { baseline: 'borrow succeeds', protected: 'limited to WATCH headroom' }, reason: 'the TWAP absorbs the held price; the cost gate (thin market) keeps WATCH', cases: ['A3'] },
  C: { letter: 'C', truth: 'HEALTHY', trigger: '+0.5% per hour', expected: 'FRESH throughout', borrow: { baseline: 'borrow succeeds', protected: 'borrow succeeds' }, reason: 'moves stay under the 3% TWAP and 5%/h velocity bands', cases: ['H2'] },
  D: { letter: 'D', truth: 'FAILURE', trigger: 'feed frozen while the market falls 40%', expected: 'PROTECTIVE', borrow: { baseline: 'over-lends', protected: 'borrow reverts (Vat/ceiling-exceeded)' }, reason: 'the Vat lends > 2% above min(market, TWAP) because the feed froze', cases: ['F1'] },
  E: { letter: 'E', truth: 'ATTACK', trigger: 'sources disagree (1500 / 2500 / 2510)', expected: 'DISPUTED → RECOVERING → FRESH', borrow: { baseline: '—', protected: 'blocked, repay works, reopens after recovery' }, reason: 'source spread > 1% → the round is DISPUTED', cases: ['R1'] },
}
const EXTRA = ['I1', 'I2', 'I5', 'I3', 'F3', 'S2', 'M3', 'V4']
const TRUTH_TONE: Record<string, Tone> = { ATTACK: 'danger', HEALTHY: 'ok', FAILURE: 'disputed' }

export function ScenariosView({ o }: { o: OriginHook }) {
  const { live, runLive, committedOf } = useLiveCase(o)
  const now = useNow(1000)
  // quiet records are routine (sync, OSM hops); validation-case runs are shown in full because the user asked for them
  const visible = o.log.filter((r) => !r.quiet || !r.pass || r.context.startsWith('Validation'))
  const [ended, setEnded] = useState<Record<string, string>>({})
  const pending = useRef<string | null>(null)
  const newest = visible.length ? visible[visible.length - 1].id : 0

  useEffect(() => {
    if (!o.busy && pending.current && o.data) {
      const id = pending.current
      pending.current = null
      setEnded((e) => ({ ...e, [id]: STATE[o.data!.snapshot.state] }))
    }
  }, [o.busy, o.data])

  const runScenario = (id: string, title: string, steps: (typeof SCENARIOS)[number]['steps']) => {
    pending.current = id
    void o.run(title, steps)
  }

  return (
    <>
      <PageHeader title="Scenarios & Log" sub="Deterministic sequences of real transactions on your local anvil chain, including time jumps. Outcomes come from the contracts; expected reverts are mined and shown with their decoded reason."
        tags={<LiveTag kind="local" />} />

      <div className="g12">
        <div className="s-7 stack">
          {SCENARIOS.map((sc) => {
            const m = META[sc.id]
            const recs = o.log.filter((r) => r.context.startsWith(sc.title))
            const txs = recs.filter((r) => r.kind === 'tx' && !r.quiet)
            const bad = recs.filter((r) => !r.pass).length
            const running = o.busy === sc.title
            return (
              <section key={sc.id} className="card scn" aria-label={sc.title}>
                <div className="scn-head">
                  <div className="scn-title">
                    <span className="letter">{m.letter}</span>
                    <div><h3>{sc.title.replace(/^[A-E]\.\s*/, '')}</h3><p className="scn-sum">{sc.summary}</p></div>
                  </div>
                  <button className="btn primary sm" disabled={!!o.busy} onClick={() => runScenario(sc.id, sc.title, sc.steps)} aria-label={`Run scenario ${sc.title}`}>
                    {running ? <><Spinner />Running…</> : <><Play size={13} />Run</>}
                  </button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={TRUTH_TONE[m.truth]} caps square>Ground truth: {m.truth}</Badge>
                  <Badge tone="neutral" icon={Target}>{m.trigger}</Badge>
                </div>
                <div className="cols">
                  <div style={{ display: 'grid', gap: 6 }}>
                    <span className="eyebrow">What we do</span>
                    <ol className="steps-mini">{sc.steps.map((s) => <li key={s.title}><span>{s.title}</span></li>)}</ol>
                  </div>
                  <div className="expect">
                    <span className="eyebrow">Expected</span>
                    <div className="er tone-info"><Activity size={13} aria-hidden="true" /><span>State: <b>{m.expected}</b></span></div>
                    <div className="er tone-neutral"><Activity size={13} aria-hidden="true" /><span>Baseline: {m.borrow.baseline}</span></div>
                    <div className="er tone-ok"><Activity size={13} aria-hidden="true" /><span>Protected: {m.borrow.protected}</span></div>
                    <div className="er tone-watch"><Activity size={13} aria-hidden="true" /><span>Reason: {m.reason}</span></div>
                    <span className="eyebrow" style={{ marginTop: 6 }}>Validated</span>
                    {m.cases.map((id) => { const c = caseById(id); return c && <div key={id} className={`er tone-${OUTCOME_TONE[c.outcome]}`}><CheckCircle2 size={13} aria-hidden="true" /><span>{id}: {OUTCOME_TEXT[c.outcome]} · final {c.actual.finalState}</span></div> })}
                  </div>
                </div>
                {recs.length > 0 && (
                  <div className={`note`} role="status">
                    {bad ? <CircleAlert size={15} className="ink tone-danger" /> : <CheckCircle2 size={15} className="ink tone-ok" />}
                    <span>This session: {txs.length} transaction{txs.length === 1 ? '' : 's'} · {recs.filter((r) => r.status === 'reverted' && r.pass).length} reverted as expected · <b className={bad ? 'ink tone-danger' : ''}>{bad} unexpected</b>{ended[sc.id] ? ` · ended in ${ended[sc.id]}` : running ? ' · running…' : ''}</span>
                  </div>
                )}
              </section>
            )
          })}
          <p className="muted small">Scenarios run from the current chain state. Use Reset chain in the top bar to start each one from the healthy snapshot.</p>

          <section className="card" aria-label="Additional threat cases">
            <div className="section-head"><div className="titles"><h2>Additional threat cases</h2><p>Lower-level attacks from the validation suite. “Run live” resets the chain and runs the case with real transactions; the result is compared with the committed validation result.</p></div><LiveTag kind="local" /></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Case</th><th>Expected</th><th>Committed result</th><th /></tr></thead>
                <tbody>
                  {EXTRA.map((id) => {
                    const c = committedOf(id)
                    if (!c) return null
                    const mine = live?.id === id
                    return (
                      <tr key={id}>
                        <td><b style={{ fontWeight: 500 }}>{id}</b> — {c.title}</td>
                        <td className="small">{c.expected}</td>
                        <td><Badge tone={OUTCOME_TONE[c.outcome]} square>{c.outcome} · {c.actual.finalState}</Badge></td>
                        <td>
                          {mine && live?.running ? <span className="loading small"><Spinner />running</span>
                            : mine && live?.res ? <Badge tone={live.res.outcome === c.outcome && live.res.actual.finalState === c.actual.finalState ? 'ok' : 'watch'} square>live: {live.res.outcome} · {live.res.actual.finalState}</Badge>
                            : <button className="btn sm" disabled={!!o.busy} onClick={() => void runLive(id)}><Play size={12} />Run live</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="s-5" style={{ position: 'sticky', top: 76 }}>
          <section className="card" aria-label="Transaction log">
            <div className="section-head"><div className="titles"><h2>Transaction log</h2><p>Local anvil transactions from this session, newest first</p></div><LiveTag kind="local" /></div>
            {visible.length === 0 ? (
              <EmptyState icon={Activity} title="No transactions yet">Run a scenario to generate live on-chain activity.</EmptyState>
            ) : (
              <div className="scroll-y" style={{ maxHeight: 'calc(100vh - 220px)' }} aria-live="polite">
                <ol className="timeline">
                  {[...visible].reverse().map((r) => <TransactionItem key={r.id} rec={r} now={now} isNew={r.id === newest} />)}
                </ol>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}
