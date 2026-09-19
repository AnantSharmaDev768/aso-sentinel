import { useEffect, useState } from 'react'
import type { CostQuote, OriginReadout, ScenarioStep } from '../../../shared/origin-core.mjs'
import { CONCERN, SCENARIOS } from '../../../shared/origin-core.mjs'
import { Badge, Card, Stat } from '../components/ui'
import { bps, ratio, toNumber, usdCompact } from '../lib/format'

interface Preset {
  id: string
  label: string
  depth: number
  headroom: number
  deviationBps: number
  note: string
}

const PRESETS: Preset[] = [
  { id: 'A', label: 'A · Thin-market pump', depth: 1_000, headroom: 100_000, deviationBps: 6_000, note: '$1k moves the price 1%; the Sentinel bounds headroom to the epoch cap.' },
  { id: 'A0', label: 'A · same, no Sentinel', depth: 1_000, headroom: 900_000, deviationBps: 6_000, note: 'Same market, the baseline’s remaining 900k headroom.' },
  { id: 'B', label: 'B · Sustained squeeze', depth: 1_000, headroom: 50_000, deviationBps: 6_000, note: 'Once the TWAP catches up, WATCH still limits headroom to 25% of the gap.' },
  { id: 'C', label: 'C · Honest movement', depth: 250_000, headroom: 100_000, deviationBps: 300, note: 'Deep market, small move: nothing is extractable below the 40% minimum.' },
  { id: 'D', label: 'D · Stale oracle', depth: 250_000, headroom: 100_000, deviationBps: 6_700, note: 'Not a manipulation-cost case: the Vat price is 67% above the real price because the feed froze. Handled by the Vat-vs-effective check.' },
  { id: 'E', label: 'E · Conflicting sources', depth: 250_000, headroom: 100_000, deviationBps: 0, note: 'Not a cost case: sources disagree, so the round is DISPUTED before any cost analysis matters.' },
]

type Result = { quote: CostQuote; concern: number; best: CostQuote }

export function CostLab({ data, quote, run, busy }: {
  data: OriginReadout
  quote: (depthUsd: number, headroomUsd: number, deviationBps: number) => Promise<Result>
  run: (context: string, steps: ScenarioStep[]) => Promise<boolean>
  busy: string | null
}) {
  const [depth, setDepth] = useState(1_000)
  const [headroom, setHeadroom] = useState(100_000)
  const [dev, setDev] = useState(6_000)
  const [preset, setPreset] = useState('A')
  const [res, setRes] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      quote(depth, headroom, dev)
        .then((r) => live && (setRes(r), setErr(null)))
        .catch((e: Error) => live && setErr(e.message.split('\n')[0]))
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [depth, headroom, dev, quote])

  const pick = (p: Preset) => {
    setPreset(p.id)
    setDepth(p.depth)
    setHeadroom(p.headroom)
    setDev(p.deviationBps)
  }
  const reset = () => pick(PRESETS[0])
  const mat = toNumber(data.matRay, 27)
  const minD = Math.max(0, (mat - 1) * 100)
  const scenarioId = preset.replace('0', '')
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)
  const note = PRESETS.find((p) => p.id === preset)?.note

  return (
    <>
      <Card title="Manipulation Cost Lab" sub="Every number below is computed by the deployed ASORiskEngine.quote() on the local chain — the same code the Sentinel uses."
        right={<button className="btn small" onClick={reset}>Reset inputs</button>}>
        <div className="chips" role="group" aria-label="Scenario presets">
          {PRESETS.map((p) => <button key={p.id} className="chip" aria-pressed={preset === p.id} onClick={() => pick(p)}>{p.label}</button>)}
        </div>
        {note && <p className="banner">{note}</p>}
        <div className="grid g3">
          <label className="field">Market depth assumption (USD that moves the price 1%)
            <input type="range" min={100} max={1_000_000} step={100} value={depth} onChange={(e) => { setDepth(+e.target.value); setPreset('') }} />
            <span className="fv">${depth.toLocaleString('en-US')} per 1%</span>
          </label>
          <label className="field">Headroom an attacker could borrow (rwaUSD)
            <input type="range" min={0} max={1_000_000} step={5_000} value={headroom} onChange={(e) => { setHeadroom(+e.target.value); setPreset('') }} />
            <span className="fv">{headroom.toLocaleString('en-US')} rwaUSD</span>
          </label>
          <label className="field">Price inflation to evaluate
            <input type="range" min={0} max={20_000} step={100} value={dev} onChange={(e) => { setDev(+e.target.value); setPreset('') }} />
            <span className="fv">+{(dev / 100).toFixed(0)}%</span>
          </label>
        </div>
      </Card>

      {err && <p className="banner error">Quote failed: {err}</p>}
      {res && (
        <div className="grid g2">
          <Card title={`At +${(dev / 100).toFixed(0)}% inflation`}>
            <div className="grid g2">
              <Stat label="Capital to move the price" value={usdCompact(res.quote.capitalUsd)} />
              <Stat label="Estimated cost (round-trip loss)" value={usdCompact(res.quote.costUsd)} />
              <Stat label="Extractable value" value={usdCompact(res.quote.extractableUsd)} sub={dev <= minD * 100 ? `zero: below the ${minD.toFixed(0)}% minimum profitable inflation` : undefined} />
              <Stat label="Cost ÷ extractable" value={ratio(res.quote.ratioBps)} />
            </div>
          </Card>
          <Card title="Cost gate verdict" right={<Badge tone={(['ok', 'watch', 'danger', 'muted'] as const)[res.concern]}>{CONCERN[res.concern]}</Badge>}
            sub="Most attractive of the evaluated attack sizes (minimum profitable + 5, 15, 30, 60 points)">
            <div className="grid g2">
              <Stat label="Attack size" value={`+${bps(res.best.deviationBps)}`} />
              <Stat label="Cost ÷ extractable" value={ratio(res.best.ratioBps)} />
              <Stat label="Cost" value={usdCompact(res.best.costUsd)} />
              <Stat label="Extractable" value={usdCompact(res.best.extractableUsd)} />
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>HIGH CONCERN below {(data.risk.highRatio / 10_000).toFixed(1)}× · ELEVATED below {(data.risk.elevatedRatio / 10_000).toFixed(1)}× · INSUFFICIENT DATA when no fresh depth assumption exists.</p>
          </Card>
        </div>
      )}

      <div className="grid g2">
        <Card title="Formula (CostModel.sol)">
          <pre className="formula">{`capital(d)     = depth_per_1% × (d in %)
cost(d)        = capital(d) × d × lossShare (${(data.risk.lossShare / 100).toFixed(0)}%)
extractable(d) = H × max(0, 1 − mat / (1 + d))     mat = ${(mat * 100).toFixed(0)}%
minimum profitable inflation d0 = mat − 1 = ${minD.toFixed(0)}%
verdict = lowest cost/extractable over d0 + {5, 15, 30, 60} points`}</pre>
        </Card>
        <Card title="What this proves — and what it does not">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13.5 }}>
            <li><b>Proves:</b> with the same assumptions, bounding the headroom (gap, WATCH share, epoch cap) bounds what a manipulation can extract.</li>
            <li><b>Proves:</b> below a {minD.toFixed(0)}% inflation nothing is extractable at a {(mat * 100).toFixed(0)}% liquidation ratio.</li>
            <li><b>Does not prove:</b> real attack cost. Depth is a governance assumption; the linear-depth and loss-share model is a rough proxy.</li>
            <li><b>Does not cover:</b> flash loans, multi-venue or coordinated manipulation, or collateral withdrawal at an inflated price.</li>
          </ul>
        </Card>
      </div>

      {scenario && (
        <Card title={`Run scenario ${scenario.title} on the local chain`} sub={scenario.summary}
          right={<button className="btn primary" disabled={!!busy} onClick={() => void run(`Scenario ${scenario.title}`, scenario.steps)}>{busy ? 'Running…' : 'Run on-chain'}</button>}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13.5 }}>
            {scenario.steps.map((s) => <li key={s.title}><b>{s.title}.</b> <span className="t2">{s.say}</span></li>)}
          </ol>
          <p className="muted" style={{ fontSize: 12.5 }}>Runs real local transactions from the current chain state. Use “Reset chain” in the top bar to start from the healthy snapshot.</p>
        </Card>
      )}
    </>
  )
}
