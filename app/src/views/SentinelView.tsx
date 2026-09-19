import type { OriginReadout } from '../../../shared/origin-core.mjs'
import { FLAGS } from '../../../shared/origin-core.mjs'
import { Badge, Card, Stat, StateBadge } from '../components/ui'
import { StateMachine } from '../components/StateMachine'
import { derive } from '../lib/derive'
import { bps, duration, rwa } from '../lib/format'

export function SentinelView({ data }: { data: OriginReadout }) {
  const d = derive(data)
  const s = d.s
  const active = new Set(d.flags.map((f) => f.key))
  const inRecovery = s.state === 4
  const healthy = s.target <= 1
  return (
    <>
      <Card title="State machine" right={<span className="muted" style={{ fontSize: 13 }}>since {duration(d.now - Number(s.stateSince))} ago (chain time)</span>}>
        <StateMachine state={s.state} previous={s.previousState} />
      </Card>

      <div className="grid g3">
        <Card className="tight"><Stat label="Current / previous" value={<span className="flow"><StateBadge state={s.state} /><span className="muted">from</span><StateBadge state={s.previousState} /></span>} sub={`signals point to ${['FRESH', 'WATCH', 'DISPUTED', 'PROTECTIVE', 'RECOVERING'][s.target]}`} /></Card>
        <Card className="tight"><Stat label="Borrowing" value={d.borrowing} tone={d.borrowing === 'Open' ? 'ok' : d.borrowing === 'Limited' ? 'watch' : 'danger'} sub={`protected ceiling ${rwa(s.line)} · debt ${rwa(s.debt)}`} /></Card>
        <Card className="tight"><Stat label="Repayments" value="Available" tone="ok" sub="the Vat skips the ceiling check when debt decreases (Multipli's dust rule still applies)" /></Card>
      </div>

      <Card title="Recovery conditions" sub="Required to leave RECOVERING. Checked on every poke().">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
          <li><Badge tone={healthy ? 'ok' : 'danger'}>{healthy ? 'met' : 'not met'}</Badge> Signals no longer at DISPUTED/PROTECTIVE level</li>
          <li><Badge tone={s.recoveryRoundSeen ? 'ok' : 'watch'}>{s.recoveryRoundSeen ? 'met' : 'waiting'}</Badge> A newer accepted round than the last restricted poke (round #{String(s.restrictedAtNonce)})</li>
          <li><Badge tone={!inRecovery ? 'muted' : d.recoveryRemaining === 0 ? 'ok' : 'watch'}>{!inRecovery ? 'n/a' : d.recoveryRemaining === 0 ? 'met' : `${duration(d.recoveryRemaining)} left`}</Badge> Recovery delay of {duration(Number(d.thresholds.recoveryDelay))} spent in RECOVERING</li>
        </ul>
      </Card>

      <Card title="Signals" sub="Every flag OriginSentinel evaluates, and whether it is active now">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Signal</th><th>Level</th><th>Active</th><th>Meaning</th></tr></thead>
            <tbody>
              {FLAGS.map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td><Badge dot={false} tone={f.level === 'protect' ? 'danger' : f.level === 'disputed' ? 'disputed' : 'watch'}>{f.level === 'protect' ? 'PROTECTIVE' : f.level === 'disputed' ? 'DISPUTED' : 'WATCH'}</Badge></td>
                  <td>{active.has(f.key) ? <strong className="tone-danger">active</strong> : <span className="muted">—</span>}</td>
                  <td className="t2">{f.explain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Configuration (on-chain, owner-bounded)">
        <dl className="kv">
          <dt>TWAP watch / protect</dt><dd>{bps(d.thresholds.twapWatchBps)} / {bps(d.thresholds.twapProtectBps)}</dd>
          <dt>Velocity watch / protect</dt><dd>{bps(d.thresholds.velWatch)}/h / {bps(d.thresholds.velProtect)}/h</dd>
          <dt>Weighted-source divergence</dt><dd>{bps(d.thresholds.sourceDivBps)}</dd>
          <dt>Vat vs effective tolerance</dt><dd>{bps(d.limits.maxPriceGapBps)}</dd>
          <dt>Gap / WATCH share / maxLine</dt><dd>{rwa(d.limits.gap)} / {bps(d.limits.watchGapBps)} / {rwa(d.limits.maxLine)}</dd>
          <dt>Epoch</dt><dd>{duration(Number(d.epoch.duration))}, net growth cap {rwa(d.epoch.cap)} · used {Math.round(d.epoch.used).toLocaleString('en-US')} rwaUSD since epoch start</dd>
        </dl>
      </Card>
    </>
  )
}
