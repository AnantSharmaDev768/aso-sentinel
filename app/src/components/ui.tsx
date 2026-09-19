import type { ReactNode } from 'react'
import { STATE_INFO, type Tone } from '../lib/risk'
import type { LoggedRecord } from '../lib/useOrigin'
import { shortHex } from '../lib/format'

export function Card({ title, sub, right, children, className = '' }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div style={{ display: 'grid', gap: 2 }}>
            {title && <h2>{title}</h2>}
            {sub && <p className="muted" style={{ fontSize: 13 }}>{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 7v4.5M8 4.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <span className="bubble" role="tooltip">{text}</span>
    </span>
  )
}

export function Stat({ label, value, sub, tip, tone }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string; tone?: Tone }) {
  return (
    <div className="stat">
      <div className="label">{label}{tip && <Tip text={tip} />}</div>
      <div className={`value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Badge({ tone = 'muted', children, dot = true, title }: { tone?: Tone | 'gold'; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function StateBadge({ state, large = false }: { state: number; large?: boolean }) {
  const s = STATE_INFO[state]
  if (!s) return <Badge>UNKNOWN</Badge>
  return large ? <span className={`state tone-${s.tone}`}>{s.name}</span> : <Badge tone={s.tone}>{s.name}</Badge>
}

export function Meter({ value, tone }: { value: number | null; tone: Tone }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value * 100))
  const color = { ok: 'var(--green)', watch: 'var(--watch)', danger: 'var(--danger)', disputed: 'var(--disputed)', recover: 'var(--recover)', muted: 'var(--border-strong)' }[tone]
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export function TxRow({ rec }: { rec: LoggedRecord }) {
  const ok = rec.pass
  const icon = rec.kind === 'check' ? (ok ? '✓' : '✗') : rec.status === 'success' ? '✓' : '⨯'
  const tone = !ok ? 'tone-danger' : rec.kind === 'tx' && rec.status === 'reverted' ? 'tone-watch' : 'tone-ok'
  return (
    <div className={`row ${ok ? '' : 'fail'}`}>
      <span className={tone} aria-hidden="true" style={{ fontWeight: 600 }}>{icon}</span>
      <div style={{ display: 'grid', gap: 2 }}>
        <div>
          {rec.label}{' '}
          {rec.kind === 'tx' && rec.status === 'reverted' && <Badge tone={ok ? 'watch' : 'danger'} dot={false}>{ok ? 'reverted as expected' : 'unexpected revert'}</Badge>}
          {rec.kind === 'tx' && rec.status === 'success' && !ok && <Badge tone="danger" dot={false}>expected a revert</Badge>}
          {rec.kind === 'check' && !ok && <Badge tone="danger" dot={false}>check failed</Badge>}
        </div>
        <div className="meta">
          {rec.kind === 'tx' ? `LOCAL anvil · tx ${shortHex(rec.hash ?? '', 10, 6)} · block ${rec.block}` : `state check · ${rec.actual}`}
          {rec.reason ? ` · reason: ${rec.reason}` : ''}
        </div>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted" style={{ fontSize: 13 }}>{children}</p>
}
