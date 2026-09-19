import { STATE_INFO } from '../lib/risk'

const LINE = ['debt + gap (capped)', 'debt + 25% of gap', 'ceiling 0', 'ceiling 0', 'ceiling 0']

/** The five states; the current one is highlighted, the previous one marked. */
export function StateMachine({ state, previous }: { state: number; previous: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="sm" role="list" aria-label="Sentinel state machine">
        {STATE_INFO.map((s, i) => (
          <div key={s.name} role="listitem" aria-current={i === state ? 'true' : undefined} className={`node ${i === state ? `on tone-${s.tone}` : ''}`} style={i === state ? {} : undefined}>
            <span className={`nm ${i === state ? `tone-${s.tone}` : ''}`}>{s.name}</span>
            <span className="ln">{s.borrowing} · {LINE[i]}</span>
            {i === state && <span className="ln tone-gold">● current</span>}
            {i === previous && i !== state && <span className="ln">previous</span>}
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        DISPUTED and PROTECTIVE never go straight to FRESH or WATCH: they pass through RECOVERING, which needs a newer accepted
        round <i>and</i> the recovery delay. Every transition happens on a permissionless <span className="mono">poke()</span>.
      </p>
    </div>
  )
}
