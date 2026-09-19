import { CheckCircle2, ChevronDown, CircleDot, Clock, GitBranch, History, ListChecks, Settings2, ShieldAlert, Table2, TriangleAlert, Workflow } from 'lucide-react'
import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { FLAGS } from '../../../shared/origin-core.mjs'
import { Badge, Card, LiveTag, PageHeader, ProgressBar, StatusBadge, Tooltip, type Tone } from '../components/ui'
import { PolicyTable, StateMachine } from '../components/viz'
import { derive } from '../lib/derive'
import { bps, duration, rwa } from '../lib/format'
import { flagReason, headline } from '../lib/insight'
import { STATE_INFO } from '../lib/risk'
import type { OriginHook } from '../lib/useOrigin'

export function SentinelView({ o, data }: { o: OriginHook; data: OriginReadout }) {
  const d = derive(data)
  const s = d.s
  const h = headline(data, d)
  const active = new Set(d.flags.map((f) => f.key))
  const lastChange = o.events.find((e) => e.kind === 'state')
  const entryFlags = lastChange?.flags ?? []
  const restrictedTarget = s.target === 2 || s.target === 3
  const conditions = [
    { ok: !restrictedTarget, label: 'Risk signals clear', sub: restrictedTarget ? `signals still point to ${STATE_INFO[s.target].name}` : 'no DISPUTED/PROTECTIVE-level signal' },
    { ok: s.recoveryRoundSeen, label: 'Newer accepted oracle round', sub: `a round newer than #${String(s.restrictedAtNonce)} (the last restricted poke)` },
    { ok: s.state === 4 ? d.recoveryRemaining === 0 : false, label: `Recovery delay (${duration(Number(d.thresholds.recoveryDelay))}) completed`, sub: s.state === 4 ? (d.recoveryRemaining > 0 ? `${duration(d.recoveryRemaining)} left` : 'delay met') : 'counts only while RECOVERING' },
  ]
  const met = conditions.filter((c) => c.ok).length
  const groups: { title: string; tone: Tone; icon: typeof ShieldAlert; items: typeof FLAGS }[] = [
    { title: 'Active protective signals', tone: 'danger', icon: ShieldAlert, items: FLAGS.filter((f) => active.has(f.key) && f.level !== 'watch') },
    { title: 'Active watch signals', tone: 'watch', icon: TriangleAlert, items: FLAGS.filter((f) => active.has(f.key) && f.level === 'watch') },
  ]
  const inactive = FLAGS.filter((f) => !active.has(f.key))

  return (
    <>
      <PageHeader title="Sentinel State" sub="What borrowing action should the protocol take? Every state maps to a different, enforced debt ceiling. The Sentinel's only write to the Vat is that ceiling."
        tags={<LiveTag kind="live" />} />

      <div className="g12 stretch">
        <Card className="s-4" title="Current state" icon={CircleDot} tone={STATE_INFO[s.state].tone as Tone}>
          <StatusBadge state={s.state} size="lg" explain animate />
          <dl className="kv">
            <dt>Previous</dt><dd><StatusBadge state={s.previousState} /></dd>
            <dt>Since</dt><dd>{duration(d.now - Number(s.stateSince))} ago (chain time)</dd>
            <dt>Signals point to</dt><dd>{STATE_INFO[s.target].name}</dd>
          </dl>
        </Card>
        <Card className="s-4" title="Why we entered it" icon={History} sub={lastChange ? `${lastChange.title} · block #${String(lastChange.block)}` : 'No state change recorded yet'} aside={<LiveTag kind="local" />}>
          {entryFlags.length ? (
            <ul className="bullets">{entryFlags.map((k) => <li key={k} className={`tone-${FLAGS.find((f) => f.key === k)?.level === 'watch' ? 'watch' : 'danger'}`}><TriangleAlert size={14} aria-hidden="true" /><span><b style={{ fontWeight: 500 }}>{FLAGS.find((f) => f.key === k)?.label ?? k}</b> — <span className="t2">{flagReason(k, data, d)}{active.has(k) ? '' : ' (no longer active)'}</span></span></li>)}</ul>
          ) : <p className="small t2">{lastChange ? 'No risk flag was active at that transition (signals cleared).' : 'The Sentinel has not changed state since deployment on this chain.'}</p>}
          <p className="muted small">From the flags recorded in the <span className="mono">StateChanged</span> event.</p>
        </Card>
        <Card className="s-4" title="Current restriction" icon={ShieldAlert}>
          <p className="small">{h.action}</p>
          <dl className="kv">
            <dt>Debt ceiling</dt><dd>{rwa(s.line)}</dd>
            <dt>Debt</dt><dd>{rwa(s.debt)}</dd>
            <dt>New debt allowed</dt><dd><b>{rwa(s.line > s.debt ? s.line - s.debt : 0n)}</b></dd>
            <dt>Repayments</dt><dd><Badge tone="ok" icon={CheckCircle2}>Available</Badge></dd>
          </dl>
        </Card>
      </div>

      <Card title="What must happen to recover" icon={ListChecks} sub="DISPUTED and PROTECTIVE never reopen directly. RECOVERING exists so that a brief normalisation cannot reopen borrowing while the attack resumes."
        aside={<Badge tone={s.state === 4 ? (met === 3 ? 'ok' : 'recover') : 'neutral'} caps square>{s.state === 4 ? `${met} of 3 conditions met` : 'not recovering'}</Badge>}>
        {s.state === 4 && <ProgressBar value={met / 3} tone={met === 3 ? 'ok' : 'recover'} thick label="Recovery conditions met" />}
        <ul className="checklist">
          {conditions.map((c) => (
            <li key={c.label} className={`tone-${c.ok ? 'ok' : s.state === 4 ? 'recover' : 'neutral'}`}>
              <span className="ck" aria-hidden="true">{c.ok ? <CheckCircle2 size={14} /> : <Clock size={13} />}</span>
              <span>{c.label}<span className="sub">{c.sub}</span></span>
              <span className="small muted">{c.ok ? 'met' : 'pending'}</span>
            </li>
          ))}
        </ul>
        <p className="small t2"><b>Next:</b> {h.next}</p>
      </Card>

      <Card title="State machine" icon={Workflow} sub="Transitions happen on the permissionless poke(); the current state is highlighted.">
        <StateMachine state={s.state} previous={s.previousState} />
      </Card>

      <Card title="State → action policy" icon={Table2} sub="Five states, five different actions. The debt-ceiling column is read live from OriginSentinel.policyLine(state) — the same function poke() applies." aside={<LiveTag kind="live" />}>
        <PolicyTable r={data} d={d} />
      </Card>

      <Card title="Signals" icon={GitBranch} sub="Every flag OriginSentinel evaluates. Active signals first.">
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.title} style={{ display: 'grid', gap: 8 }}>
            <span className={`eyebrow ink tone-${g.tone}`}>{g.title} ({g.items.length})</span>
            {g.items.map((f) => (
              <div key={f.key} className={`callout tone-${f.level === 'watch' ? 'watch' : f.level === 'disputed' ? 'disputed' : 'danger'}`}>
                <span className="ico"><g.icon size={18} aria-hidden="true" /></span>
                <span className="t"><b>{f.level === 'watch' ? 'WATCH' : f.level === 'disputed' ? 'DISPUTED' : 'PROTECTIVE'} · {f.label}</b><span>{flagReason(f.key, data, d)}.</span></span>
                <Tooltip align="right" content={<><b>{f.key}.</b> {f.explain}</>} />
              </div>
            ))}
          </div>
        ))}
        {d.flags.length === 0 && <p className="small t2">No signal is active.</p>}
        <details className="why">
          <summary>Inactive signals ({inactive.length})<ChevronDown size={15} className="chev" aria-hidden="true" /></summary>
          <div className="table-wrap" style={{ padding: '0 14px 14px' }}>
            <table className="table">
              <thead><tr><th>Signal</th><th>Level</th><th>Meaning</th></tr></thead>
              <tbody>{inactive.map((f) => <tr key={f.key}><td>{f.label}</td><td><Badge tone={f.level === 'protect' ? 'danger' : f.level === 'disputed' ? 'disputed' : 'watch'} square>{f.level === 'protect' ? 'PROTECTIVE' : f.level === 'disputed' ? 'DISPUTED' : 'WATCH'}</Badge></td><td className="small t2">{f.explain}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card title="Configuration (on-chain, owner-bounded)" icon={Settings2}>
        <dl className="kv">
          <dt>TWAP watch / protect</dt><dd>{bps(d.thresholds.twapWatchBps)} / {bps(d.thresholds.twapProtectBps)}</dd>
          <dt>Velocity watch / protect</dt><dd>{bps(d.thresholds.velWatch)}/h / {bps(d.thresholds.velProtect)}/h</dd>
          <dt>Weighted-source divergence</dt><dd>{bps(d.thresholds.sourceDivBps)}</dd>
          <dt>Vat price rule</dt><dd>must not lend more than {bps(d.limits.maxPriceGapBps)} above min(market, 6 h TWAP) → PROTECTIVE</dd>
          <dt>Gap · WATCH share · max line</dt><dd>{rwa(d.limits.gap)} · {bps(d.limits.watchGapBps)} · {rwa(d.limits.maxLine)}</dd>
          <dt>Epoch growth cap</dt><dd>{rwa(d.epoch.cap)} per {duration(Number(d.epoch.duration))} · {Math.round(d.epoch.used).toLocaleString('en-US')} used</dd>
          <dt>Recovery delay</dt><dd>{duration(Number(d.thresholds.recoveryDelay))}</dd>
        </dl>
      </Card>
    </>
  )
}
