import { Fragment, useMemo, useState } from 'react'
import {
  BookOpen, ChevronRight, CircleAlert, ExternalLink, FlaskConical, GitCompareArrows, History, Layers, ListChecks, Play, Scale, ShieldAlert, ShieldCheck, Target,
} from 'lucide-react'
import { CASES, HOLDOUT } from '../../../shared/validation.mjs'
import { useLiveCase } from '../lib/liveCase'
import { HISTORICAL } from '../../../shared/historical.mjs'
import { ANALYSIS } from '../../../shared/analysis.mjs'
import { Badge, Card, LiveTag, LoadingState, Note, PageHeader, Tooltip, type Tone } from '../components/ui'
import { ConfusionMatrix } from '../components/viz'
import { BOUNDARIES } from '../lib/boundaries'
import type { OriginHook } from '../lib/useOrigin'
import { OUTCOME_TEXT, OUTCOME_TONE, RESULTS, pct, secs, type ValidationFile } from '../lib/validation'

type RuleKey = keyof typeof RESULTS
type SuiteKey = 'main' | 'holdout'
const RULE_LABEL: Record<RuleKey, string> = { final: 'Final rules', baseline: 'Baseline rules', candidate: 'Candidate GRADED (rejected)' }
const STATE_TONE: Record<string, Tone> = { FRESH: 'ok', WATCH: 'watch', DISPUTED: 'disputed', PROTECTIVE: 'danger', RECOVERING: 'recover' }

const DEFS = {
  TP: 'True positive: a risk case in which the Sentinel reached the required protection (or the verifier rejected the data) and did not lapse back to unrestricted borrowing while the risk persisted.',
  FN: 'False negative: a risk case in which the Sentinel never reached the required protection, or reopened unrestricted borrowing while the risk persisted.',
  TN: 'True negative: a healthy case in which borrowing was never restricted.',
  FP: 'False positive: the Sentinel restricted borrowing (WATCH or stricter) even though the test case was labelled healthy.',
  recall: 'Recall = TP / (TP + FN): the share of risk cases that were caught.',
  precision: 'Precision = TP / (TP + FP): of all protective outcomes, the share that were real risks.',
  fpr: 'False-positive rate = FP / (FP + TN): the share of healthy cases that were restricted anyway.',
  latency: 'Chain time from the ground-truth onset of the risk to the first poke that met the required protection. The harness pokes after every price event, so keeper delay is excluded.',
}

const SURFACE: { attack: string; verifier: string; risk: string; action: string; cases: string[] }[] = [
  { attack: 'Invalid / forged signature', verifier: 'Rejects (InvalidSignature)', risk: '—', action: 'No state change', cases: ['I1'] },
  { attack: 'Unauthorised signer', verifier: 'Rejects (UnauthorizedSigner)', risk: '—', action: 'No state change', cases: ['I2'] },
  { attack: 'Replay / stale nonce', verifier: 'Rejects (NonceNotIncreasing)', risk: '—', action: 'No fresh round created', cases: ['I3', 'I4'] },
  { attack: 'Duplicated signer / insufficient quorum', verifier: 'Rejects (SignersNotStrictlyAscending / QuorumNotMet)', risk: '—', action: 'No state change', cases: ['I5', 'I6'] },
  { attack: 'Expired attestation', verifier: 'Rejects (Expired)', risk: '—', action: 'No state change', cases: ['I7'] },
  { attack: 'Source disagreement (1–4 of 5 lie)', verifier: 'Accepts as DISPUTED (spread > 1%)', risk: '—', action: 'DISPUTED: frozen', cases: ['M1', 'M2', 'M3', 'M4', 'F3'] },
  { attack: 'Colluding majority, valid signatures', verifier: 'Accepts (cryptographically valid)', risk: 'TWAP deviation, velocity', action: 'PROTECTIVE: frozen', cases: ['V3', 'V4', 'V5'] },
  { attack: 'Thin-market pump, all sources honest', verifier: 'Accepts', risk: 'TWAP, velocity, cost gate', action: 'PROTECTIVE: frozen', cases: ['A1'] },
  { attack: 'Sudden / creeping large move', verifier: 'Accepts', risk: 'Velocity, TWAP deviation', action: 'PROTECTIVE', cases: ['A2', 'A5'] },
  { attack: 'Stale upstream price (feed frozen)', verifier: 'Accepts the real price', risk: 'Vat above effective; Multipli adapter stale', action: 'PROTECTIVE', cases: ['F1', 'F2'] },
  { attack: 'Source outage (< quorum online)', verifier: 'No new round possible', risk: 'Data ages out (1 h)', action: 'PROTECTIVE after expiry', cases: ['S2', 'S1', 'S0'] },
  { attack: 'Sustained manipulation beyond the TWAP window', verifier: 'Accepts', risk: 'Signals fade as the TWAP absorbs it', action: 'Bounded by epoch cap — may reopen', cases: ['A3', 'A4'] },
  { attack: 'Sub-threshold manipulation (< 3%)', verifier: 'Accepts', risk: 'Below every band', action: 'None (detection floor)', cases: ['A6'] },
]

export function ValidationView({ o }: { o: OriginHook }) {
  const [rules, setRules] = useState<RuleKey>('final')
  const [suite, setSuite] = useState<SuiteKey>('main')
  const [group, setGroup] = useState('All')
  const [open, setOpen] = useState<string | null>(null)
  const set: ValidationFile = RESULTS[rules][suite]
  const s = set.summary
  const groups = useMemo(() => ['All', ...new Set(set.cases.map((c) => c.group))], [set])
  const shown = set.cases.filter((c) => group === 'All' || c.group === group)
  const misses = RESULTS.final.main.cases.concat(RESULTS.final.holdout.cases).filter((c) => c.outcome === 'FP' || c.outcome === 'FN')
  const other = (id: string) => RESULTS.candidate.main.cases.concat(RESULTS.candidate.holdout.cases).find((c) => c.id === id)
  const fin = (id: string) => RESULTS.final.main.cases.concat(RESULTS.final.holdout.cases).find((c) => c.id === id)

  const { live, runLive } = useLiveCase(o)
  const rerun = runLive

  return (
    <>
      <PageHeader title="Validation" sub="Does the Sentinel catch the dangerous cases while avoiding unnecessary restrictions? Labelled scenarios run against the real contracts; every number below is read from the generated result files."
        tags={<><LiveTag kind="local" /><Tooltip align="right" content={<>Generated by <b>{set.meta.command}</b> at {set.meta.generatedAt.slice(0, 19).replace('T', ' ')} UTC · commit {set.meta.gitCommit ?? '—'}{set.meta.workingTreeClean ? '' : ' (uncommitted changes)'} · {set.meta.durationSeconds} s. Rules: {set.meta.ruleDescription}.</>} /></>} />

      <div className="note" style={{ alignItems: 'center' }}>
        <CircleAlert size={15} />
        <span><Badge tone="gold" caps square>Synthetic local validation</Badge> Team-designed scenarios on a local chain with test-key sources — <b>not real-world deployment performance</b>. Several cases were included because we expected the design to miss them; ground truth was fixed before each run. <b>The current policy is intentionally conservative: the measured false positives show the cost of protecting exposure aggressively.</b></span>
      </div>

      <div className="row between">
        <div className="filters" role="group" aria-label="Rule set">
          {(Object.keys(RESULTS) as RuleKey[]).map((r) => <button key={r} className="fchip" aria-pressed={rules === r} onClick={() => setRules(r)}>{RULE_LABEL[r]}</button>)}
        </div>
        <div className="filters" role="group" aria-label="Suite">
          {(['main', 'holdout'] as SuiteKey[]).map((x) => <button key={x} className="fchip" aria-pressed={suite === x} onClick={() => { setSuite(x); setGroup('All'); setOpen(null) }}>{x === 'main' ? 'Main suite' : 'Holdout suite'}<span className="c">{RESULTS[rules][x].summary.total}</span></button>)}
        </div>
      </div>

      <div className="g12 stretch">
        <Card className="s-5" title={`N = ${s.total} test cases`} icon={ListChecks} sub={`${s.risk} risk · ${s.healthy} healthy · ${s.degraded} degraded — ${RULE_LABEL[rules]}, ${suite} suite`}>
          <ConfusionMatrix TP={s.TP} FN={s.FN} FP={s.FP} TN={s.TN} />
          <div className="row small t2">Degraded cases matching the documented policy: <b>{s.degradedMatch} / {s.degraded}</b></div>
        </Card>
        <div className="s-7 stack">
          <div className="kpis">
            <div className="kpi"><span className="kl">Recall<Tooltip content={DEFS.recall} /></span><span className="kv">{pct(s.recall)}</span><span className="ks">{s.TP} of {s.TP + s.FN} risk cases</span></div>
            <div className="kpi"><span className="kl">Precision<Tooltip content={DEFS.precision} /></span><span className="kv">{pct(s.precision)}</span><span className="ks">{s.TP} of {s.TP + s.FP} protective outcomes</span></div>
            <div className="kpi tone-watch"><span className="kl">False-positive rate<Tooltip content={DEFS.fpr} /></span><span className="kv ink">{pct(s.falsePositiveRate)}</span><span className="ks">{s.FP} of {s.FP + s.TN} healthy cases</span></div>
            <div className="kpi"><span className="kl">Detection latency<Tooltip content={DEFS.latency} /></span><span className="kv">{s.latency ? secs(s.latency.median) : '—'}</span><span className="ks">{s.latency ? `median · max ${secs(s.latency.max)} · ${s.latency.cases} cases` : 'not measured'}</span></div>
            <div className="kpi"><span className="kl">Healthy pokes restricted</span><span className="kv">{s.healthyRestrictedPokes}/{s.healthyPokes}</span><span className="ks">{s.healthyBlockedPokes} fully frozen</span></div>
            <div className="kpi tone-ok"><span className="kl">Invariant checks</span><span className="kv">{s.invariantChecks}</span><span className="ks ink">{s.invariantViolations} violations</span></div>
            <div className="kpi tone-ok"><span className="kl">State transitions</span><span className="kv">{s.transitions}</span><span className="ks ink">{s.transitionViolations} rule violations</span></div>
            <div className="kpi"><span className="kl">Verifier rejections</span><span className="kv">{s.verifierRejections}</span><span className="ks">invalid data stopped in the same tx</span></div>
          </div>
        </div>
      </div>

      <Card title="Baseline, candidate and final — side by side" icon={GitCompareArrows} sub="The baseline is never overwritten. One alternative rule was evaluated on both suites and rejected; the final rules equal the baseline rules.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Result set</th><th>Suite</th><th className="r">N</th><th className="r">TP</th><th className="r">FN</th><th className="r">TN</th><th className="r">FP</th><th className="r">Recall</th><th className="r">Precision</th><th className="r">FP rate</th><th className="r">Healthy pokes frozen</th></tr></thead>
            <tbody>
              {(['baseline', 'candidate', 'final'] as RuleKey[]).flatMap((r) => (['main', 'holdout'] as SuiteKey[]).map((x) => {
                const m = RESULTS[r][x].summary
                return (
                  <tr key={r + x} className={r === rules && x === suite ? 'current' : ''} style={r === rules && x === suite ? { background: 'var(--gold-bg)' } : undefined}>
                    <td>{RULE_LABEL[r]}</td><td>{x}</td><td className="r">{m.total}</td><td className="r">{m.TP}</td><td className="r">{m.FN}</td><td className="r">{m.TN}</td><td className="r">{m.FP}</td>
                    <td className="r">{pct(m.recall)}</td><td className="r">{pct(m.precision)}</td><td className="r">{pct(m.falsePositiveRate)}</td><td className="r">{m.healthyBlockedPokes} / {m.healthyPokes}</td>
                  </tr>
                )
              }))}
            </tbody>
          </table>
        </div>
        <div className="g12" style={{ gap: 12 }}>
          <div className="s-6 inc" style={{ gap: 8 }}>
            <span className="eyebrow ink tone-gold">The candidate (proposed before any result)</span>
            <p><b>Why:</b> the baseline compares the Vat price with min(market, 6 h TWAP) at 2% and freezes — effectively an undocumented TWAP rule stricter than the documented 3% / 15% bands. The candidate froze only on Vat vs <i>current market</i> + 2% and graded Vat vs TWAP with the existing 3% band. No new threshold.</p>
            <p><b>Risk named in advance:</b> shorter freezes during sustained manipulation once the OSM passes the manipulated price through.</p>
          </div>
          <div className="s-6 inc" style={{ gap: 8 }}>
            <span className="eyebrow ink tone-danger">Outcome and decision (after the runs)</span>
            <p>No TP/FN/TN/FP count changed on either suite. Honest rallies lost 2 frozen pokes; sustained manipulations (A3, A4, X11) lost the same 2 frozen pokes. <b>Rejected:</b> under a bounded-loss, fail-closed priority that trade is not an improvement. The rule is kept and now stated explicitly: <i>the Vat must not lend more than 2% above min(market, 6 h average)</i>.</p>
            <p className="muted small">Selected by design reasoning, not by searching thresholds against these cases. The holdout suite was written before the change and used only to evaluate it.</p>
          </div>
        </div>
      </Card>

      <Card title="Every false positive and false negative, explained" icon={FlaskConical} sub={`Final rules, main + holdout suites · ${misses.length} cases. Click a row for the analysis.`}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th /><th>Case</th><th>Outcome</th><th>Signals</th><th>States</th><th>Candidate rule</th></tr></thead>
            <tbody>
              {misses.map((c) => {
                const a = ANALYSIS[c.id as keyof typeof ANALYSIS] as { why: string; appropriate: string; mitigation: string } | undefined
                const sig = c.outcome === 'FP' ? c.restriction?.causes ?? [] : [...new Set(c.observations.flatMap((x) => x.flags))]
                const alt = other(c.id)
                const isOpen = open === `m-${c.id}`
                return (
                  <Fragment key={c.id}>
                    <tr className="xrow" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : `m-${c.id}`)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(isOpen ? null : `m-${c.id}`))}>
                      <td><ChevronRight size={15} className="chev" /></td>
                      <td><b style={{ fontWeight: 500 }}>{c.id}</b> — {c.title}<div className="muted small">ground truth: {c.truth}</div></td>
                      <td><Badge tone={OUTCOME_TONE[c.outcome]} caps square>{OUTCOME_TEXT[c.outcome]}</Badge></td>
                      <td className="mono small">{sig.join(', ') || 'none'}</td>
                      <td className="small">{c.actual.statesSeen.join(' → ')}</td>
                      <td className="small">{alt ? `${alt.outcome} · ${alt.actual.statesSeen.join(' → ')}` : '—'}</td>
                    </tr>
                    {isOpen && a && (
                      <tr className="xdetail"><td colSpan={6}>
                        <div className="g12" style={{ gap: 14 }}>
                          <div className="s-4"><span className="eyebrow">Scenario</span><p className="small t2">{c.description}</p><p className="small t2" style={{ marginTop: 6 }}>{c.restriction ? `Restricted at ${c.restriction.pokes} of ${c.restriction.of} pokes (${c.restriction.blockedPokes} frozen); back to FRESH: ${c.restriction.returnedToFresh ? 'yes' : 'no'}.` : c.latencyNote}</p></div>
                          <div className="s-4"><span className="eyebrow">{c.outcome === 'FP' ? 'Why the restriction happened' : 'Why protection did not hold'}</span><p className="small t2">{a.why}</p></div>
                          <div className="s-4"><span className="eyebrow">{c.outcome === 'FP' ? 'Appropriate? · Mitigation' : 'Security implication · Future improvement'}</span><p className="small t2">{a.appropriate}</p><p className="small t2" style={{ marginTop: 6 }}><b>→</b> {a.mitigation}</p></div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="All test cases" icon={Target} sub={`${RULE_LABEL[rules]}, ${suite} suite. Click a row for the poke-by-poke record.`}
        aside={<div className="filters" role="group" aria-label="Filter by group">{groups.map((g) => <button key={g} className="fchip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}<span className="c">{g === 'All' ? set.cases.length : set.cases.filter((c) => c.group === g).length}</span></button>)}</div>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th /><th>ID</th><th>Scenario</th><th>Truth</th><th>Sources online · manipulated</th><th>Expected (policy)</th><th>Actual</th><th>Borrow (final)</th><th>Latency</th><th>Result</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const isOpen = open === `c-${c.id}`
                return (
                  <Fragment key={c.id}>
                    <tr className="xrow" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : `c-${c.id}`)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(isOpen ? null : `c-${c.id}`))}>
                      <td><ChevronRight size={15} className="chev" /></td>
                      <td className="mono">{c.id}</td>
                      <td>{c.title}<div className="muted small">{c.trigger}</div></td>
                      <td><Badge tone={c.truth === 'risk' ? 'danger' : c.truth === 'healthy' ? 'ok' : 'watch'} square>{c.truth}</Badge></td>
                      <td className="num">{c.sources.online}/5 · {c.sources.manipulated}</td>
                      <td className="small">{c.expected}</td>
                      <td><Badge tone={STATE_TONE[c.actual.finalState ?? ''] ?? 'neutral'} square>{c.actual.finalState}</Badge></td>
                      <td className="small">{c.actual.borrowProbeFinal == null ? '—' : c.actual.borrowProbeFinal ? 'would succeed' : 'would revert'}</td>
                      <td className="small">{c.required === 'reject' ? 'same tx' : secs(c.latencySeconds)}</td>
                      <td><Badge tone={OUTCOME_TONE[c.outcome]} caps square>{c.outcome}</Badge></td>
                    </tr>
                    {isOpen && (
                      <tr className="xdetail"><td colSpan={10}>
                        <p className="small t2" style={{ marginBottom: 10 }}>{c.description}</p>
                        {c.rejections.length > 0 && <p className="small" style={{ marginBottom: 8 }}>Verifier: {c.rejections.map((r) => `${r.label} → ${r.reverted ? `reverted ${r.reason ?? ''}` : 'NOT rejected'}`).join(' · ')}</p>}
                        <div className="obs">
                          {c.observations.map((x, i) => (
                            <div className="or" key={i}>
                              <span className="small">{x.label}</span>
                              <Badge tone={STATE_TONE[x.state] ?? 'neutral'} square>{x.state}</Badge>
                              <span className="fl">{x.flags.join(', ') || 'no flags'}</span>
                              <span className="small muted">borrow {x.borrowOk ? '✓' : '✗'} · repay {x.repayOk ? '✓' : '✗'} · baseline {x.baselineBorrowOk ? '✓' : '✗'}</span>
                            </div>
                          ))}
                        </div>
                        {c.checks.length > 0 && <p className="small" style={{ marginTop: 8 }}>Checks: {c.checks.map((k) => `${k.pass ? '✓' : '✗'} ${k.label}`).join(' · ')}</p>}
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="callout tone-watch">
        <span className="ico"><ShieldAlert size={20} aria-hidden="true" /></span>
        <span className="t"><b>Cryptographic validity vs economic safety</b><span>In V3–V5 a colluding majority signs a +60% price: the verifier accepts the round because every signature is valid, and only the risk engine freezes borrowing. In A1 all five sources honestly report a manipulated market — the same situation from the market side.</span></span>
        <span className="row">{['V3', 'V4', 'V5', 'A1'].map((id) => { const c = fin(id); return c && <Badge key={id} tone={OUTCOME_TONE[c.outcome]} square>{id} {c.actual.finalState}</Badge> })}</span>
      </div>

      <Card title="Attack surface matrix" icon={Layers} sub="Which layer handles each attack, and what the validation run measured (final rules)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Attack type</th><th>Verifier</th><th>Risk engine</th><th>Sentinel action</th><th>Measured</th></tr></thead>
            <tbody>
              {SURFACE.map((row) => (
                <tr key={row.attack}>
                  <td>{row.attack}</td><td className="small">{row.verifier}</td><td className="small">{row.risk}</td><td className="small">{row.action}</td>
                  <td><span className="row" style={{ gap: 4 }}>{row.cases.map((id) => { const c = fin(id); return c && <Badge key={id} tone={OUTCOME_TONE[c.outcome]} square>{id} {c.outcome}</Badge> })}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Historical validation" icon={History} sub="Six documented incidents. Facts come only from the cited sources; the mapping is our interpretation; the reproduced tests use synthetic prices. No historical data is replayed and no claim is made that Origin would have prevented any incident.">
        <div className="g12" style={{ gap: 14 }}>
          {HISTORICAL.map((h) => (
            <article key={h.id} className="inc s-6">
              <div className="ih"><div><h3>{h.name}</h3><span className="muted small">{h.protocol} · {h.date} · {h.pattern}</span></div></div>
              <div className="lbl"><b className="ink tone-info">Historical fact</b><ul>{h.facts.map((f) => <li key={f}>{f}</li>)}</ul></div>
              <div className="lbl"><b className="ink tone-gold">Retrospective mapping</b><p>{h.mapping}</p></div>
              <div className="lbl"><b className="ink tone-ok">Reproduced test (synthetic pattern)</b><span className="row" style={{ gap: 4 }}>{h.reproduced.map((id) => { const c = fin(id); return <Badge key={id} tone={c ? OUTCOME_TONE[c.outcome] : 'neutral'} square>{id}{c ? ` · ${c.outcome} · ${c.actual.finalState}` : ''}</Badge> })}</span></div>
              <div className="lbl"><b className="ink tone-danger">Not modeled</b><p>{h.notModeled}</p></div>
              <div className="src">{h.sources.map((x) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />{x.label}</a>)}</div>
            </article>
          ))}
        </div>
      </Card>

      <div className="g12">
        <Card className="s-7" title="Known detection boundaries" icon={ShieldCheck} sub="What Origin does not claim — limits of scope, not failures of the concept">
          <ol className="checklist">
            {BOUNDARIES.map((b, i) => <li key={b.t} className="tone-watch"><span className="ck">{i + 1}</span><span>{b.t}<span className="sub">{b.d}</span></span><span /></li>)}
          </ol>
        </Card>
        <Card className="s-5" title="Methodology" icon={BookOpen}>
          <ul className="bullets">
            {(['TP', 'FN', 'TN', 'FP'] as const).map((k) => <li key={k}><Scale size={14} aria-hidden="true" /><span><b>{OUTCOME_TEXT[k]}.</b> <span className="t2">{DEFS[k].split(': ')[1]}</span></span></li>)}
            <li><Scale size={14} aria-hidden="true" /><span><b>Invariants at every poke.</b> <span className="t2">The poke never changes the collateral price; restricted ⇒ ceiling 0; ceiling = policyLine(state); a repayment would succeed; a borrow would revert when restricted.</span></span></li>
            <li><Scale size={14} aria-hidden="true" /><span><b>Probes.</b> <span className="t2">Borrow/repay results come from eth_call probes after each poke — nothing extra is mined.</span></span></li>
          </ul>
          <p className="muted small">Reproduce: <span className="mono">cd demo &amp;&amp; npm run validate</span> · baseline: <span className="mono">-- --rules=baseline</span></p>
        </Card>
      </div>

      <Card title="Re-run a case live" icon={Play} sub="Resets the dashboard's local chain to the healthy snapshot, runs the case with the deployed default rules, and compares with the committed final result.">
        <div className="row">
          <select className="btn select" aria-label="Choose a case" defaultValue="A1" id="live-case">
            {[...CASES, ...HOLDOUT].map((c) => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}
          </select>
          <button className="btn primary" disabled={!!o.busy} onClick={() => void rerun((document.getElementById('live-case') as HTMLSelectElement).value)}><Play size={14} />Reset & run live</button>
        </div>
        {live?.running && <LoadingState>Running {live.id} on the local chain…</LoadingState>}
        {live && !live.running && (live.res ? (() => {
          const ref = fin(live.id)
          const same = ref && ref.outcome === live.res.outcome && ref.actual.finalState === live.res.actual.finalState
          return (
            <div className={`callout tone-${same ? 'ok' : 'watch'}`}>
              <span className="ico">{same ? <ShieldCheck size={20} /> : <CircleAlert size={20} />}</span>
              <span className="t"><b>{live.id}: live {live.res.outcome} · {live.res.actual.finalState}</b><span>Committed result: {ref ? `${ref.outcome} · ${ref.actual.finalState}` : '—'} · {live.res.pokes} pokes, {live.res.invariantViolations.length} invariant violations. {same ? 'Reproduced.' : 'Differs from the committed file — investigate before relying on it.'}</span></span>
              <Badge tone={same ? 'ok' : 'watch'} caps square>{same ? 'match' : 'differs'}</Badge>
            </div>
          )
        })() : <Note icon={CircleAlert}>{live.error ?? 'No result.'}</Note>)}
      </Card>
    </>
  )
}
