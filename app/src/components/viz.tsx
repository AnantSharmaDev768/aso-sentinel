import { Fragment, type ReactNode } from 'react'
import {
  ArrowRight, Ban, BookOpenCheck, CheckCircle2, CircleDot, Clock, Coins, Gauge, GitFork, Layers, Landmark, Lock, Radio, Scale, ShieldCheck,
  Signature, TriangleAlert, Waves, XCircle, type LucideIcon,
} from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { Term, Badge, EmptyState, type Tone } from './ui'
import { STATE_ICON } from './ui-helpers'
import { STATE_INFO } from '../lib/risk'
import { derive } from '../lib/derive'
import { bps, duration, rwa, usd } from '../lib/format'
import { CHECK_TONE, type Check } from '../lib/insight'
import { simTime } from '../lib/chain'
import type { ChainEvent } from '../lib/events'
import type { Term as TermKey } from '../lib/glossary'

type D = ReturnType<typeof derive>

// ---------------------------------------------------------------------------------------------- pipeline

/** Price sources → verifier → risk engine → Sentinel → debt ceiling → borrowing, coloured by live state. */
export function Pipeline({ r, d }: { r: OriginReadout; d: D }) {
  const s = d.s
  const has = (k: string) => d.flags.some((f) => f.key === k)
  const v = r.verifier
  const coverage = r.risk.weightedNonce !== 0n && r.risk.weightedNonce === v.lastAcceptedNonce ? r.risk.weightedSourceCount : null
  const marketRisk = d.flags.filter((f) => !['ASO_HALTED', 'ASO_DISPUTED', 'ASO_NO_DATA', 'ASO_STALE'].includes(f.key))
  const info = STATE_INFO[s.state]
  const headroom = s.line > s.debt ? s.line - s.debt : 0n
  const nodes: { k: string; icon: LucideIcon; v: ReactNode; st: string; tone: Tone; ok: boolean; term?: TermKey }[] = [
    { k: 'Price sources', icon: Radio, v: coverage === null ? '5 authorised' : `${coverage} / 5 signed`, st: has('SOURCE_COVERAGE_MIN') ? 'minimum quorum only' : 'EIP-712 attestations', tone: has('SOURCE_COVERAGE_MIN') ? 'watch' : 'ok', ok: !has('SOURCE_COVERAGE_MIN'), term: 'Attestation' },
    { k: 'Verifier', icon: Signature, v: `${String(v.quorum)} / 5 quorum`, st: ['no data', 'signatures valid', 'stale', 'disputed', 'halted'][v.status], tone: v.status === 1 ? 'ok' : v.status === 3 ? 'disputed' : 'danger', ok: v.status === 1, term: 'Quorum' },
    { k: 'Accepted price', icon: CheckCircle2, v: usd(s.attestedPrice), st: `round #${String(v.lastAcceptedNonce)} · ${duration(d.age)} old`, tone: has('ASO_STALE') ? 'danger' : 'ok', ok: !has('ASO_STALE'), term: 'Freshness' },
    { k: 'Risk engine', icon: Gauge, v: s.twapOk ? `TWAP ${usd(s.twap, 0)}` : 'TWAP pending', st: marketRisk.length ? `${marketRisk.length} market signal${marketRisk.length > 1 ? 's' : ''}` : 'no market signal', tone: marketRisk.some((f) => f.level === 'protect') ? 'danger' : marketRisk.length ? 'watch' : 'ok', ok: marketRisk.length === 0, term: 'TWAP' },
    { k: 'Sentinel', icon: STATE_ICON[s.state], v: info.name, st: info.short, tone: info.tone, ok: s.state === 0 },
    { k: 'Debt ceiling', icon: Landmark, v: rwa(s.line).replace(' rwaUSD', ''), st: `debt ${rwa(s.debt).replace(' rwaUSD', '')}`, tone: s.line === 0n ? 'danger' : s.state === 1 ? 'watch' : 'ok', ok: s.line > s.debt, term: 'Debt ceiling' },
    { k: 'New borrowing', icon: s.line === 0n ? Lock : Coins, v: d.borrowing.toUpperCase(), st: s.line === 0n ? 'repayments still work' : `${rwa(headroom)} available`, tone: d.borrowing === 'Open' ? 'ok' : d.borrowing === 'Limited' ? 'watch' : 'danger', ok: d.borrowing === 'Open', term: 'Headroom' },
  ]
  return (
    <ol className="pipeline" aria-label="Oracle protection pipeline, live">
      {nodes.map((n) => (
        <li key={n.k} className={`pnode tone-${n.tone}`} style={{ listStyle: 'none' }}>
          <span className="pk"><n.icon size={13} aria-hidden="true" />{n.term ? <Term t={n.term}>{n.k}</Term> : n.k}</span>
          <span className="pv">{n.v}</span>
          <span className="ps">{n.ok ? <CheckCircle2 size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}{n.st}</span>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------- state machine

export function StateMachine({ state, previous }: { state: number; previous: number }) {
  const node = (i: number) => {
    const s = STATE_INFO[i]
    const Icon = STATE_ICON[i]
    const cur = i === state
    return (
      <div key={s.name} className={`snode tone-${s.tone} ${cur ? 'current' : ''}`} role="listitem" aria-current={cur ? 'step' : undefined}>
        {cur && <span className="cur-tag">CURRENT</span>}
        {!cur && i === previous && <span className="prev-tag">PREVIOUS</span>}
        <span className="sn-name"><Icon size={15} aria-hidden="true" />{s.name}</span>
        <span className="sn-desc">{s.effect}</span>
        <span className="sn-line">{s.line}</span>
      </div>
    )
  }
  return (
    <div>
      <div className="fsm" role="list" aria-label="Sentinel state machine">
        <div className="col">{node(0)}<span className="swap" aria-hidden="true">⇅ warning on / off</span>{node(1)}</div>
        <div className="link" aria-hidden="true"><span>risk signal</span></div>
        <div className="col">{node(2)}{node(3)}</div>
        <div className="link" aria-hidden="true"><span>signals clear</span></div>
        <div className="col">{node(4)}</div>
      </div>
      <div className="fsm-return"><ArrowRight size={14} aria-hidden="true" style={{ transform: 'scaleX(-1)' }} />RECOVERING → FRESH / WATCH only after a <b>newer accepted round</b> and the <b>1 h recovery delay</b>. A new risk signal sends it straight back.</div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- policy matrix

/** The state → action policy. The debt-ceiling column is read live from OriginSentinel.policyLine(state). */
export function PolicyTable({ r, d, compact = false }: { r: OriginReadout; d: D; compact?: boolean }) {
  const t = d.thresholds
  const debt = d.s.debt
  const rows = [
    { trig: 'No active risk flag', act: 'Normal borrowing', rec: '—', meaning: 'Healthy: data fresh, sources agree, market calm' },
    { trig: `Any warning: TWAP ≥ ${bps(t.twapWatchBps)}, velocity ≥ ${bps(t.velWatch)}/h, cost ELEVATED or no depth data, thin TWAP history, source divergence ≥ ${bps(t.sourceDivBps)}, only the minimum quorum of sources`, act: 'Borrowing limited', rec: 'Automatic when the warning clears', meaning: 'Meaningful warning, not enough evidence to freeze' },
    { trig: 'Latest round spread > 1% between sources', act: 'Borrowing frozen', rec: '→ RECOVERING once an agreeing round is accepted', meaning: 'No trustworthy price: sources disagree' },
    { trig: `Stale/missing/halted data, Multipli feed stale, Vat lending > ${bps(d.limits.maxPriceGapBps)} above min(market, 6 h TWAP), TWAP ≥ ${bps(t.twapProtectBps)}, velocity ≥ ${bps(t.velProtect)}/h, cost HIGH`, act: 'Borrowing frozen', rec: '→ RECOVERING when every signal clears', meaning: 'Data may be valid, but lending more is economically dangerous' },
    { trig: 'Signals cleared after DISPUTED or PROTECTIVE', act: 'Still frozen', rec: `Newer accepted round + ${duration(Number(t.recoveryDelay))} delay, signals still clear`, meaning: 'Danger cleared, stability not yet proven' },
  ]
  return (
    <div className="table-wrap">
      <table className="table policy">
        <thead>
          <tr><th>State</th>{!compact && <th>Meaning</th>}<th>Trigger</th><th>Borrowing action</th><th><Term t="Debt ceiling">Debt ceiling now</Term></th><th>Repayment</th><th>Recovery</th></tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const s = STATE_INFO[i]
            const line = r.policy?.[i] ?? 0n
            const room = line > debt ? line - debt : 0n
            const Icon = STATE_ICON[i]
            return (
              <tr key={s.name} className={`tone-${s.tone} ${i === d.s.state ? 'current' : ''}`} aria-current={i === d.s.state ? 'true' : undefined}>
                <td><span className="status" style={{ padding: '3px 9px' }}><Icon size={13} aria-hidden="true" />{s.name}</span>{i === d.s.state && <div className="eyebrow" style={{ marginTop: 6, color: 'var(--tone)' }}>current</div>}</td>
                {!compact && <td className="small">{row.meaning}</td>}
                <td className="small">{row.trig}</td>
                <td><span className="act">{row.act}</span></td>
                <td className="num">{line === 0n ? <b className="ink">0</b> : rwa(line)}<div className="muted small">{line === 0n ? 'no new debt' : `+${rwa(room)} headroom`}</div></td>
                <td><Badge tone="ok" icon={CheckCircle2}>Available</Badge></td>
                <td className="small">{row.rec}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- scorecard

export function Scorecard({ checks }: { checks: Check[] }) {
  const icon = { PASS: CheckCircle2, WATCH: TriangleAlert, BLOCKED: XCircle, WAITING: Clock, 'N/A': CircleDot }
  return (
    <ul className="score" aria-label="Security scorecard">
      {checks.map((c) => {
        const Icon = icon[c.status]
        return (
          <li key={c.label}>
            <span className="sl"><b style={{ fontWeight: 500 }}>{c.term ? <Term t={c.term as TermKey} align="left">{c.label}</Term> : c.label}</b><span title={c.detail}>{c.detail}</span></span>
            <span className={`chk tone-${CHECK_TONE[c.status]}`}><Icon size={12} aria-hidden="true" />{c.status}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------- confusion matrix

export function ConfusionMatrix({ TP, FN, FP, TN }: { TP: number; FN: number; FP: number; TN: number }) {
  return (
    <div className="confusion" role="table" aria-label="Confusion matrix">
      <span />
      <span className="hd" role="columnheader">Sentinel protected</span>
      <span className="hd" role="columnheader">Sentinel did not protect</span>
      <span className="hd rh" role="rowheader">Risk case</span>
      <div className="cell tone-ok" role="cell"><span className="n">{TP}</span><span className="k">True positive</span><span className="d">risk present, protection reached</span></div>
      <div className="cell tone-danger" role="cell"><span className="n">{FN}</span><span className="k">False negative</span><span className="d">risk present, borrowing unrestricted</span></div>
      <span className="hd rh" role="rowheader">Healthy case</span>
      <div className="cell tone-watch" role="cell"><span className="n">{FP}</span><span className="k">False positive</span><span className="d">healthy, but borrowing restricted</span></div>
      <div className="cell tone-ok" role="cell"><span className="n">{TN}</span><span className="k">True negative</span><span className="d">healthy, never restricted</span></div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- comparison bars

export function CompareBars({ rows }: { rows: { label: string; value: number; text: string; tone: Tone }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="cmp">
      {rows.map((r) => (
        <div className="cmp-row" key={r.label}>
          <div className="lbl"><b>{r.label}</b><span className="v">{r.text}</span></div>
          <div className={`hbar tone-${r.tone}`} role="img" aria-label={`${r.label}: ${r.text}`}><span style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- event timeline

const EV_ICON: Record<ChainEvent['kind'], LucideIcon> = { round: CheckCircle2, disputed: GitFork, state: ShieldCheck, depth: Scale, borrow: Coins, repay: Coins, halt: Ban }
const EV_TONE: Record<ChainEvent['kind'], Tone> = { round: 'info', disputed: 'disputed', state: 'gold', depth: 'neutral', borrow: 'watch', repay: 'ok', halt: 'danger' }

export function EventList({ events, limit = 8, now }: { events: ChainEvent[]; limit?: number; now: bigint }) {
  if (!events.length) return <EmptyState icon={Waves} title="No contract events yet">Events appear as rounds are accepted, the Sentinel changes state and users borrow or repay.</EmptyState>
  return (
    <ol className="timeline" aria-label="Recent on-chain events">
      {events.slice(0, limit).map((e) => {
        const Icon = EV_ICON[e.kind]
        const tone = e.kind === 'state' && e.toState !== undefined ? STATE_INFO[e.toState].tone : EV_TONE[e.kind]
        return (
          <li key={e.key} className={`tl-item tone-${tone}`}>
            <span className="dot" aria-hidden="true"><Icon size={13} /></span>
            <div className="body">
              <div className="head"><span className="ttl">{e.title}</span><span className="when" title="Chain time (simulated)">{simTime(e.time, duration)} · {duration(Number(now - e.time))} ago</span></div>
              {(e.detail || e.flags?.length) && <span className="meta">{e.detail ?? ''}{e.flags?.length ? `signals: ${e.flags.join(', ')}` : ''}</span>}
              <span className="meta">block #{String(e.block)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------- why different

export function WhyDifferent() {
  const layers: { q: string; w: string; icon: LucideIcon; tone: Tone; ours?: boolean }[] = [
    { q: 'Is the price report valid?', w: 'Signatures, quorum, freshness, replay — ASOVerifier', icon: BookOpenCheck, tone: 'info' },
    { q: 'Is the market behaving safely?', w: 'TWAP deviation, velocity, source divergence — ASORiskEngine', icon: Gauge, tone: 'watch', ours: true },
    { q: 'Is manipulation economically concerning?', w: 'Modelled cost vs extractable value — cost gate', icon: Scale, tone: 'watch', ours: true },
    { q: 'Should we allow additional debt right now?', w: 'State → debt ceiling, epoch growth cap — OriginSentinel', icon: Layers, tone: 'gold', ours: true },
  ]
  return (
    <div className="layers">
      <p className="small t2">A typical oracle guard asks only the first question. Origin keeps asking after the data is valid, because all
        sources can honestly report a manipulated market.</p>
      {layers.map((l, i) => (
        <Fragment key={l.q}>
          <div className={`layer tone-${l.tone} ${l.ours ? 'ours' : ''}`}>
            <span className="li"><l.icon size={17} aria-hidden="true" /></span>
            <span style={{ display: 'grid', gap: 2 }}><span className="lq">{l.q}</span><span className="lw">{l.w}</span></span>
            {i === 0 ? <Badge tone="neutral">typical guard</Badge> : <Badge tone="gold">Origin adds</Badge>}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
