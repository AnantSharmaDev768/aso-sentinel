import { useState } from 'react'
import type { OriginReadout, ScenarioStep } from '../../../shared/origin-core.mjs'
import { PRESENTATION } from '../../../shared/origin-core.mjs'
import { Badge, Card, StateBadge } from '../components/ui'
import { derive } from '../lib/derive'
import { rwa, usd } from '../lib/format'

export function PresentationView({ data, run, busy, reset }: { data: OriginReadout; run: (c: string, s: ScenarioStep[]) => Promise<boolean>; busy: string | null; reset: () => Promise<void> }) {
  const [next, setNext] = useState(0)
  const [failed, setFailed] = useState<number | null>(null)
  const d = derive(data)
  const doStep = async (i: number) => {
    const ok = await run(`Presentation ${PRESENTATION[i].title}`, [PRESENTATION[i]])
    if (ok) { setNext(i + 1); setFailed(null) } else setFailed(i)
  }
  const restart = async () => { await reset(); setNext(0); setFailed(null) }
  return (
    <div className="grid g2">
      <Card title="Presentation mode" sub="A guided judge walkthrough. Each step sends real local transactions; the right-hand panel is read from the contracts."
        right={<button className="btn small" disabled={!!busy} onClick={() => void restart()}>Restart from healthy snapshot</button>}>
        <div className="steps">
          {PRESENTATION.map((s, i) => (
            <div key={s.title} className={`step ${i < next ? 'done' : ''} ${i === next ? 'current' : ''}`}>
              <span className="idx">{i < next ? '✓' : i + 1}</span>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong>{s.title.replace(/^\d+\.\s*/, '')}</strong>
                <span className="t2" style={{ fontSize: 13.5 }}>{s.say}</span>
                {failed === i && <span className="tone-danger" style={{ fontSize: 13 }}>This step did not complete — see the error banner. Restart from the healthy snapshot.</span>}
              </div>
              <button className="btn small primary" disabled={!!busy || i !== next} onClick={() => void doStep(i)}>{busy && i === next ? 'Running…' : 'Run'}</button>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Live contract state" sub="Refreshed after every step">
        <div className="flow"><StateBadge state={d.s.state} large /></div>
        <dl className="kv">
          <dt>New borrowing</dt><dd>{d.borrowing}</dd>
          <dt>Repayments</dt><dd>available</dd>
          <dt>Protected ceiling / debt</dt><dd>{rwa(d.s.line)} / {rwa(d.s.debt)}</dd>
          <dt>Attested / effective / Vat</dt><dd>{usd(d.s.attestedPrice)} / {usd(d.s.effectivePrice)} / {usd(d.s.vatPrice)}</dd>
        </dl>
        <div className="flow">
          {d.flags.length === 0 ? <span className="muted">No active signal</span> : d.flags.map((f) => <Badge key={f.key} tone={f.level === 'protect' ? 'danger' : f.level === 'disputed' ? 'disputed' : 'watch'}>{f.label}</Badge>)}
        </div>
      </Card>
    </div>
  )
}
