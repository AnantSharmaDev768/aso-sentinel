import { useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronDown, CircleDot, Coins, Landmark, Lightbulb, LoaderCircle, Play, RotateCcw, ShieldAlert, Wallet } from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN, PRESENTATION, STATE } from '../../../shared/origin-core.mjs'
import { Badge, LiveTag, StatusBadge, TransactionItem, type Tone } from '../components/ui'
import { useNow } from '../components/ui-helpers'
import { derive } from '../lib/derive'
import { duration, ratio, rwa, usd } from '../lib/format'
import { flagReason } from '../lib/insight'
import { STATE_INFO } from '../lib/risk'
import type { OriginHook } from '../lib/useOrigin'

const STORY: { short: string; beats: string[]; why: { t: string; p: string }[] }[] = [
  { short: 'Healthy', beats: ['Five sources sign prices; a 3-of-5 quorum makes a round', 'Data is fresh and the sources agree', 'Sentinel is FRESH: normal borrowing', 'Alice has borrowed on both markets'],
    why: [{ t: 'Why this matters', p: 'In a healthy market the Sentinel is invisible. It never changes the oracle price — it only decides how much new debt the Vat may take on.' }] },
  { short: 'Disagreement', beats: ['Sources sign $1,500 / $2,500 / $2,510', 'The verifier records the round as DISPUTED (spread > 1%)', 'Debt ceiling → 0: new borrowing blocked', 'Repayments remain available'],
    why: [{ t: 'Why this matters', p: 'No trustworthy price means no new debt. The price itself is untouched, so nobody is liquidated because of the dispute.' }] },
  { short: 'Cost Warning', beats: ['Sources agree again at $2,500', 'Governance assumes a thin market ($1,000 moves the price 1%)', 'Cost gate: modelled cost < 3× extractable value → ELEVATED', 'Still recovering: new borrowing stays blocked'],
    why: [{ t: 'Why this matters', p: 'Valid data is not the same as a safe market. If manipulation looks cheap relative to what it could extract, the Sentinel stays cautious even though every signature checks out.' }, { t: 'An honest caveat', p: 'The cost gate is a model built on an assumed market depth, not a measurement.' }] },
  { short: 'Protective', beats: ['Every source signs a pumped $4,000 (+60%)', 'Verifier: the round is valid — quorum met', 'Risk engine: far from the TWAP, moving 60% per hour', 'PROTECTIVE: Bob’s borrow reverts on-chain'],
    why: [{ t: 'Why this matters', p: 'This is the case a source quorum cannot catch: every source honestly reports a manipulated market. The Sentinel blocks new debt anyway — without changing the price.' }] },
  { short: 'Repayment', beats: ['New borrowing is still blocked', 'Alice repays 10,000 rwaUSD', 'The Vat skips the ceiling check when debt goes down'],
    why: [{ t: 'Why repayments still work', p: 'Reducing debt never needs ceiling room, so users can always lower their exposure during a restriction. The protection never traps anyone.' }] },
  { short: 'Fresh Round', beats: ['The market returns to $2,500', 'Agreeing rounds arrive every hour until the signals clear', 'RECOVERING — not FRESH', 'New borrowing still blocked'],
    why: [{ t: 'Why this matters', p: 'A brief normalisation must not reopen borrowing: an attacker could pause and resume. Recovery has to prove stability first.' }] },
  { short: 'Recovery', beats: ['A newer accepted round and the 1 h recovery delay', 'Borrowing reopens — first limited (WATCH) while the TWAP remembers the pump', 'Bob borrows 1,000 rwaUSD', 'FRESH once the 6 h window rolls past the pump'],
    why: [{ t: 'Why this matters', p: 'Reopening is gradual: limited headroom first, normal borrowing only once the price history is clean again.' }] },
]

export function PresentationView({ o, data }: { o: OriginHook; data: OriginReadout }) {
  const [next, setNext] = useState(0)
  const [view, setView] = useState(0)
  const [failed, setFailed] = useState<number | null>(null)
  const [done, setDone] = useState<Record<number, string>>({})
  const [justDone, setJustDone] = useState<number | null>(null)
  const d = derive(data)
  const s = d.s
  const info = STATE_INFO[s.state]
  const busy = !!o.busy
  const running = busy && o.busy?.startsWith('Presentation')
  const step = PRESENTATION[view]
  const story = STORY[view]

  const runStep = async (i: number) => {
    setJustDone(null)
    const ok = await o.run(`Presentation ${PRESENTATION[i].title}`, [PRESENTATION[i]])
    if (ok) {
      setNext(i + 1)
      setFailed(null)
      setJustDone(i)
      setView(Math.min(i + 1, PRESENTATION.length - 1))
    } else setFailed(i)
  }
  const restart = async () => { await o.reset(); setNext(0); setView(0); setFailed(null); setDone({}); setJustDone(null) }
  // record the state each step ended in (read from the contract after the step)
  if (justDone !== null && !busy && done[justDone] === undefined) setDone((x) => ({ ...x, [justDone]: STATE[s.state] }))

  const a = o.activity
  const now = useNow(1000)
  return (
    <>
      <header className="pres-head">
        <div className="row between top">
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="kicker">ORIGIN // ASO SENTINEL</span>
            <h1>Live security demonstration</h1>
            <p className="t2" style={{ maxWidth: 720 }}>Watch the Sentinel respond to changing oracle conditions. Every step sends real transactions to the local chain and the live state panel reads the contracts after each step.</p>
          </div>
          <div className="row"><LiveTag kind="local" /><button className="btn" disabled={busy} onClick={() => void restart()}><RotateCcw size={14} />Restart from healthy snapshot</button></div>
        </div>
        <ol className="stepper" aria-label="Demo progress">
          {PRESENTATION.map((p, i) => (
            <li key={p.title} className={`${i < next ? 'done' : ''} ${i === next ? 'current' : ''} ${failed === i ? 'failed' : ''}`}>
              <button className="sd" onClick={() => setView(i)} aria-label={`Step ${i + 1}: ${STORY[i].short}${i < next ? ' (done)' : i === next ? ' (next)' : ''}`} aria-current={i === view ? 'step' : undefined}>
                {i < next ? <CheckCircle2 size={15} /> : i + 1}
              </button>
              <span className="sl">{STORY[i].short}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className="g12 stretch">
        <section className="card s-6 stage" aria-label="Current step">
          <span className="st-num">STEP {view + 1} OF {PRESENTATION.length}{view < next ? ' · DONE' : view === next ? ' · NEXT' : ' · LATER'}</span>
          <h2>{step.title.replace(/^\d+\.\s*/, '')}</h2>
          <p className="st-say">{step.say}</p>
          <ul className="beats">{story.beats.map((b) => <li key={b}><ArrowRight size={15} aria-hidden="true" />{b}</li>)}</ul>

          <div className="phase" aria-live="polite">
            {running && a ? (
              <>
                {a.last && <div className="ph-row"><CheckCircle2 size={15} className="ink tone-ok" />Transaction confirmed: {a.last.label}{a.last.kind === 'tx' ? <span className="mono">block #{a.last.block}{a.last.status === 'reverted' ? ' · reverted as expected' : ''}</span> : null}</div>}
                <div className="ph-row"><LoaderCircle size={15} className="spin ink tone-gold" />{a.phase === 'reading' ? 'Reading Sentinel state…' : a.last ? 'Submitting next transaction…' : 'Submitting transaction & waiting for confirmation…'}</div>
              </>
            ) : failed === view ? (
              <div className="ph-row ink tone-danger"><ShieldAlert size={15} />This step did not complete — see the error banner, then restart from the healthy snapshot.</div>
            ) : done[view] ? (
              <div className="ph-row"><CheckCircle2 size={15} className="ink tone-ok" />Step complete · the Sentinel ended in <b>&nbsp;{done[view]}</b> (read from OriginSentinel)</div>
            ) : view === next ? (
              <div className="ph-row muted"><CircleDot size={15} />Ready. Press Run to send this step's transactions.</div>
            ) : view < next ? (
              <div className="ph-row"><CheckCircle2 size={15} className="ink tone-ok" />Done.</div>
            ) : (
              <div className="ph-row muted"><CircleDot size={15} />Run the earlier steps first.</div>
            )}
          </div>

          <div className="row">
            <button className="btn primary lg" disabled={busy || view !== next} onClick={() => void runStep(view)}>
              {running ? <><LoaderCircle size={15} className="spin" />Running…</> : <><Play size={15} />Run step {view + 1}</>}
            </button>
            {view < next && next < PRESENTATION.length && <button className="btn" onClick={() => setView(next)}>Go to step {next + 1} <ArrowRight size={14} /></button>}
            {next >= PRESENTATION.length && <Badge tone="ok" icon={CheckCircle2} caps square>Walkthrough complete</Badge>}
          </div>

          {(() => {
            const recs = o.log.filter((r) => r.context.startsWith(`Presentation ${step.title}`) && (!r.quiet || !r.pass))
            if (view >= next && !running) return null
            if (!recs.length) return done[view] ? <p className="small muted">This step sends no transactions — it reads the current contract state.</p> : null
            return (
              <div style={{ display: 'grid', gap: 6 }}>
                <span className="eyebrow">Transactions in this step (local chain)</span>
                <ol className="timeline scroll-y" style={{ maxHeight: 220 }}>
                  {recs.slice(-8).reverse().map((r) => <TransactionItem key={r.id} rec={r} now={now} />)}
                </ol>
              </div>
            )
          })()}

          <details className="why" open>
            <summary><Lightbulb size={15} aria-hidden="true" />{story.why[0].t}<ChevronDown size={15} className="chev" aria-hidden="true" /></summary>
            <div className="why-body">{story.why.map((w) => <div key={w.t}><b>{w.t}</b><p>{w.p}</p></div>)}</div>
          </details>
        </section>

        <section className="card s-6 live-panel" aria-label="Live contract state">
          <div className="section-head"><div className="titles"><h2>Live contract state</h2><p>OriginSentinel.snapshot() · refreshed after every step</p></div><LiveTag kind="live" /></div>
          <div className={`live-state tone-${info.tone}`}>
            <StatusBadge state={s.state} size="xl" animate />
            <span className="t2">{info.short} · {info.effect}</span>
          </div>
          <div className="live-grid">
            <div className={`live-cell tone-${d.borrowing === 'Open' ? 'ok' : d.borrowing === 'Limited' ? 'watch' : 'danger'}`}><span className="eyebrow"><Coins size={12} /> New borrowing</span><span className="v tone">{d.borrowing.toUpperCase()}</span></div>
            <div className="live-cell tone-ok"><span className="eyebrow"><Wallet size={12} /> Repayments</span><span className="v tone">AVAILABLE</span></div>
            <div className="live-cell"><span className="eyebrow"><Landmark size={12} /> Debt ceiling</span><span className="v">{rwa(s.line)}</span></div>
            <div className="live-cell"><span className="eyebrow">Current debt</span><span className="v">{rwa(s.debt)}</span></div>
            <div className="live-cell"><span className="eyebrow">Attested price</span><span className="v">{usd(s.attestedPrice)}</span></div>
            <div className="live-cell"><span className="eyebrow">TWAP (6 h)</span><span className="v">{s.twapOk ? usd(s.twap) : '—'}</span></div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <span className="eyebrow">Active signals</span>
            {d.flags.length === 0 ? <span className="small muted">None — all checks pass.</span> : (
              <ul className="bullets">{d.flags.map((f) => <li key={f.key} className={`tone-${f.level === 'watch' ? 'watch' : f.level === 'disputed' ? 'disputed' : 'danger'}`}><ShieldAlert size={14} aria-hidden="true" /><span><b style={{ fontWeight: 500 }}>{f.label}</b> <span className="t2">— {flagReason(f.key, data, d)}</span></span></li>)}</ul>
            )}
          </div>
          {s.state === 4 && (
            <div className="note"><CircleDot size={15} /><span>Recovery: {s.recoveryRoundSeen ? 'newer round seen ✓' : 'waiting for a newer round'} · {d.recoveryRemaining > 0 ? `${duration(d.recoveryRemaining)} of delay left` : 'delay met ✓'}</span></div>
          )}
          <div className="row between small">
            <span className="t2">Cost gate: <Badge tone={(['ok', 'watch', 'danger', 'neutral'] as Tone[])[s.concern]} square>{CONCERN[s.concern]}</Badge></span>
            <span className="muted">cost ÷ extractable {ratio(s.costQuote.ratioBps)}</span>
          </div>
        </section>
      </div>
    </>
  )
}
