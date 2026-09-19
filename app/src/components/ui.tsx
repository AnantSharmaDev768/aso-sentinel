import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { STATE_ICON, ago, recordView } from './ui-helpers'
import { CircleAlert, CircleHelp, Copy, CopyCheck, Inbox, LoaderCircle, X, type LucideIcon } from 'lucide-react'
import { STATE_INFO } from '../lib/risk'
import { GLOSSARY, type Term as TermKey } from '../lib/glossary'
import type { LoggedRecord } from '../lib/useOrigin'
import { shortHex } from '../lib/format'

export type Tone = 'ok' | 'watch' | 'danger' | 'disputed' | 'recover' | 'info' | 'neutral' | 'muted' | 'gold'


// ---------------------------------------------------------------- layout

export function PageHeader({ title, sub, tags }: { title: string; sub?: ReactNode; tags?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {tags && <div className="tags">{tags}</div>}
    </header>
  )
}

export function SectionHeader({ title, sub, icon: Icon, aside, level = 2 }: { title: ReactNode; sub?: ReactNode; icon?: LucideIcon; aside?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div className="section-head">
      <div className="titles">
        <H>{Icon && <Icon size={17} aria-hidden="true" />}{title}</H>
        {sub && <p>{sub}</p>}
      </div>
      {aside && <div className="aside">{aside}</div>}
    </div>
  )
}

export function Card({ title, sub, icon, aside, children, className = '', tone, compact, label }: {
  title?: ReactNode; sub?: ReactNode; icon?: LucideIcon; aside?: ReactNode; children?: ReactNode; className?: string; tone?: Tone; compact?: boolean; label?: string
}) {
  return (
    <section className={`card ${compact ? 'compact' : ''} ${tone ? `accent tone-${tone}` : ''} ${className}`} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      {(title || aside) && <SectionHeader title={title} sub={sub} icon={icon} aside={aside} />}
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- data provenance

const TAGS = {
  live: { tone: 'ok', text: 'Live contract state', title: 'Read from the deployed contracts on the local chain, refreshed every few seconds.' },
  local: { tone: 'gold', text: 'Local anvil', title: 'Transactions on your private local anvil chain (chain id 31337). Disposable.' },
  modelled: { tone: 'info', text: 'Modelled', title: 'Computed from governance assumptions (market depth, loss share). An estimate, not a measurement.' },
  sepolia: { tone: 'neutral', text: 'Public testnet · Sepolia', title: 'Committed evidence from the public Ethereum Sepolia testnet (v1 core only).' },
  estimate: { tone: 'neutral', text: 'Browser estimate', title: 'Calculated in the browser from contract values, for explanation only. Nothing on-chain depends on it.' },
} as const

export function LiveTag({ kind }: { kind: keyof typeof TAGS }) {
  const t = TAGS[kind]
  return (
    <span className={`live-tag tone-${t.tone} ${kind === 'live' ? 'live' : ''}`} title={t.title}>
      <span className="pulse" aria-hidden="true" />{t.text}
    </span>
  )
}

// ---------------------------------------------------------------- badges

export function Badge({ tone = 'neutral', icon: Icon, children, caps, square, title }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; caps?: boolean; square?: boolean; title?: string }) {
  return (
    <span className={`badge tone-${tone} ${caps ? 'caps' : ''} ${square ? 'square' : ''}`} title={title}>
      {Icon && <Icon size={13} aria-hidden="true" />}
      {children}
    </span>
  )
}

export function StatusBadge({ state, size = 'md', explain = false, animate = false }: { state: number; size?: 'md' | 'lg' | 'xl'; explain?: boolean; animate?: boolean }) {
  const s = STATE_INFO[state]
  if (!s) return <Badge>UNKNOWN</Badge>
  const Icon = STATE_ICON[state]
  const px = size === 'xl' ? 32 : size === 'lg' ? 17 : 14
  return (
    <span className="row" style={{ gap: 10 }}>
      <span key={animate ? state : undefined} className={`status ${size === 'md' ? '' : size} tone-${s.tone} ${animate ? 'state-anim' : ''}`} role="status" aria-label={`Sentinel state ${s.name}: ${s.short}`}>
        <Icon size={px} aria-hidden="true" />{s.name}
      </span>
      {explain && <span className="muted small">{s.short}</span>}
    </span>
  )
}

// ---------------------------------------------------------------- tooltip

/** Tooltip that opens on hover, keyboard focus, and click/tap (not hover-only). Escape closes it. */
export function Tooltip({ content, children, align = 'center', term = false }: { content: ReactNode; children?: ReactNode; align?: 'center' | 'left' | 'right'; term?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close) }
  }, [open])
  return (
    <span ref={ref} className={`tt ${align === 'center' ? '' : align} ${open ? 'open' : ''}`}>
      <button type="button" className={`tt-trigger ${term ? 'term' : ''}`} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {children}
        {!term && <CircleHelp className="qi" size={13} aria-hidden="true" />}
        {!children && <span className="sr-only">More information</span>}
      </button>
      <span className="tt-bubble" role="tooltip" id={id}>{content}</span>
    </span>
  )
}

/** A glossary term with its definition as a tooltip. */
export function Term({ t, children, align }: { t: TermKey; children?: ReactNode; align?: 'center' | 'left' | 'right' }) {
  return <Tooltip term align={align} content={<><b>{t}.</b> {GLOSSARY[t]}</>}>{children ?? t}</Tooltip>
}

// ---------------------------------------------------------------- metrics

export function MetricCard({ label, tip, value, sub, foot, tone, small, footTone }: {
  label: ReactNode; tip?: ReactNode; value: ReactNode; sub?: ReactNode; foot?: ReactNode; tone?: Tone; small?: boolean; footTone?: Tone
}) {
  return (
    <div className="card compact metric">
      <div className="m-label">{label}{tip && <Tooltip content={tip} align="left" />}</div>
      <div className={`m-value ${small ? 'sm' : ''} ${tone ? `ink tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="m-sub">{sub}</div>}
      {foot && <div className={`m-foot ${footTone ? `ink tone-${footTone}` : ''}`}>{foot}</div>}
    </div>
  )
}

export function ProgressBar({ value, tone, thick, label, mark }: { value: number | null; tone: Tone; thick?: boolean; label: string; mark?: number }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value * 100))
  return (
    <div className={`bar ${thick ? 'thick' : ''} tone-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
      {mark !== undefined && <i className="mark" style={{ left: `${mark * 100}%` }} aria-hidden="true" />}
    </div>
  )
}

export function SignalRow({ icon: Icon, tone, label, detail, value, pctText, hot }: { icon: LucideIcon; tone: Tone; label: ReactNode; detail: string; value: number | null; pctText: string; hot?: boolean }) {
  return (
    <div className={`signal tone-${tone} ${hot ? 'hot' : ''}`}>
      <span className="ico"><Icon size={16} aria-hidden="true" /></span>
      <span className="nm"><b>{label}</b><span title={detail}>{detail}</span></span>
      <ProgressBar value={value} tone={tone} label={`${typeof label === 'string' ? label : 'signal'} utilisation`} />
      <span className="pct">{pctText}</span>
    </div>
  )
}

// ---------------------------------------------------------------- states

export function EmptyState({ icon: Icon = Inbox, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <span className="ico"><Icon size={20} aria-hidden="true" /></span>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  )
}

export function LoadingState({ children }: { children: ReactNode }) {
  return <span className="loading" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" />{children}</span>
}

export function Alert({ tone = 'danger', title, message, reason, detail, onDismiss }: { tone?: Tone; title: string; message: ReactNode; reason?: string | null; detail?: string; onDismiss?: () => void }) {
  const [show, setShow] = useState(false)
  return (
    <div className={`alert tone-${tone}`} role="alert">
      <span className="ico"><CircleAlert size={18} aria-hidden="true" /></span>
      <div className="t">
        <b>{title}</b>
        <span className="msg">{message}</span>
        {reason && <span className="reason">Reason: <span className="mono">{reason}</span></span>}
        {detail && (
          <>
            <button type="button" className="btn ghost sm" style={{ justifySelf: 'start', padding: '2px 0' }} aria-expanded={show} onClick={() => setShow((v) => !v)}>{show ? 'Hide details' : 'View details'}</button>
            {show && <pre>{detail}</pre>}
          </>
        )}
      </div>
      {onDismiss && <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button>}
    </div>
  )
}

export function Note({ icon: Icon = CircleHelp, children }: { icon?: LucideIcon; children: ReactNode }) {
  return <p className="note"><Icon size={15} aria-hidden="true" /><span>{children}</span></p>
}

// ---------------------------------------------------------------- transactions

export function TransactionItem({ rec, now, isNew }: { rec: LoggedRecord; now: number; isNew?: boolean }) {
  const v = recordView(rec)
  const Icon = v.icon
  return (
    <li className={`tl-item tone-${v.tone} ${isNew ? 'new' : ''}`}>
      <span className="dot" aria-hidden="true"><Icon size={14} /></span>
      <div className="body">
        <div className="head">
          <span className="ttl">{rec.label}</span>
          <span className="when">{ago(rec.at, now)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={v.tone} caps square>{v.tag}</Badge>
          {rec.kind === 'tx' && <span className="meta">block #{rec.block} · {shortHex(rec.hash ?? '', 6, 4)}</span>}
        </div>
        {rec.kind === 'check' && rec.actual && <span className="meta">{rec.actual}</span>}
        {rec.reason && <span className="meta">reason: {rec.reason}</span>}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------- misc

export function Addr({ address, href, head = 5, tail = 4 }: { address: string; href?: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard unavailable: the full address is still in the title */ }
  }
  const short = shortHex(address, head, tail)
  return (
    <span className="addr">
      {href ? <a className="mono" href={href} target="_blank" rel="noreferrer" title={address}>{short}</a> : <span className="mono" title={address}>{short}</span>}
      <button type="button" className="copy" onClick={() => void copy()} aria-label={copied ? 'Address copied' : `Copy address ${address}`}>
        {copied ? <CopyCheck size={13} /> : <Copy size={13} />}
      </button>
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} aria-hidden="true" />
}
