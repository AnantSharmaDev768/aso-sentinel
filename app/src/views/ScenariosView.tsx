import type { ScenarioStep } from '../../../shared/origin-core.mjs'
import { SCENARIOS } from '../../../shared/origin-core.mjs'
import { Card, Empty, TxRow } from '../components/ui'
import type { LoggedRecord } from '../lib/useOrigin'

export function ScenariosView({ run, busy, log }: { run: (c: string, s: ScenarioStep[]) => Promise<boolean>; busy: string | null; log: LoggedRecord[] }) {
  const visible = log.filter((r) => !r.quiet || !r.pass)
  return (
    <div className="grid g2">
      <div className="grid" style={{ alignContent: 'start' }}>
        {SCENARIOS.map((sc) => (
          <Card key={sc.id} title={sc.title} sub={sc.summary}
            right={<button className="btn primary small" disabled={!!busy} onClick={() => void run(sc.title, sc.steps)}>{busy === sc.title ? 'Running…' : 'Run'}</button>}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 3 }} className="t2">
              {sc.steps.map((s) => <li key={s.title}>{s.title}</li>)}
            </ol>
          </Card>
        ))}
        <p className="muted" style={{ fontSize: 12.5 }}>
          Scenarios are deterministic sequences of real transactions on your local anvil chain, including time jumps. Outcomes come from the
          contracts. Start from a known state with “Reset chain”.
        </p>
      </div>
      <Card title="Transaction log" sub="LOCAL anvil transactions from this session. Expected reverts are mined and shown with their decoded reason.">
        <div className="log" aria-live="polite">
          {visible.length === 0 ? <Empty>No transactions yet. Run a scenario.</Empty> : [...visible].reverse().map((r) => <TxRow key={r.id} rec={r} />)}
        </div>
      </Card>
    </div>
  )
}
