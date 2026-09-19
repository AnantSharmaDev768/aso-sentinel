import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Calculator, CircleAlert, FlaskConical, LineChart, Play, RotateCcw, Table2, TriangleAlert } from 'lucide-react'
import type { CostQuote, OriginReadout } from '../../../shared/origin-core.mjs'
import { CONCERN, SCENARIOS } from '../../../shared/origin-core.mjs'
import { Badge, Card, LiveTag, LoadingState, Note, PageHeader, Term, type Tone } from '../components/ui'
import { CompareBars } from '../components/viz'
import { SensitivityChart, type SensSeries } from '../components/charts'
import { ratio, toNumber, usdCompact } from '../lib/format'
import type { OriginHook } from '../lib/useOrigin'
import { VALIDATION } from '../lib/validation'

interface Preset { id: string; letter: string; title: string; desc: string; depth: number; headroom: number; dev: number; scenario?: string }
const PRESETS: Preset[] = [
  { id: 'A', letter: 'A', title: 'Thin-market pump', desc: '$1k moves the price 1%; the Sentinel bounds headroom to the daily cap.', depth: 1_000, headroom: 100_000, dev: 6_000, scenario: 'A' },
  { id: 'A0', letter: 'A′', title: 'Thin market, no Sentinel', desc: 'Same market, but the baseline’s 900k of remaining headroom.', depth: 1_000, headroom: 900_000, dev: 6_000 },
  { id: 'B', letter: 'B', title: 'Sustained squeeze', desc: 'Once the TWAP catches up, WATCH still limits headroom to 25% of the gap.', depth: 1_000, headroom: 50_000, dev: 6_000, scenario: 'B' },
  { id: 'C', letter: 'C', title: 'Honest movement', desc: 'Deep market, small move: nothing is extractable below the 40% minimum.', depth: 250_000, headroom: 100_000, dev: 300, scenario: 'C' },
  { id: 'D', letter: 'D', title: 'Stale oracle', desc: 'Not a cost case: the feed froze and the Vat lends above the market. Caught by the Vat price check.', depth: 250_000, headroom: 100_000, dev: 6_700, scenario: 'D' },
]
const DEPTHS = [{ label: 'Low depth $1k/1%', v: 1_000, color: '#3F6FA6', dash: '2 3' }, { label: 'Medium $25k/1%', v: 25_000, color: '#5A8FD0', dash: '7 3' }, { label: 'High $250k/1%', v: 250_000, color: '#A9C8F0' }]
const SENS_D = [45, 50, 55, 60, 70, 85, 100, 120]
const CONCERN_TONE: Tone[] = ['ok', 'watch', 'danger', 'neutral']

const depthFromSlider = (x: number) => Math.round(10 ** (2 + (x / 1000) * 4) / 100) * 100
const sliderFromDepth = (d: number) => Math.round(((Math.log10(Math.max(100, d)) - 2) / 4) * 1000)
const fill = (v: number, min: number, max: number) => ({ '--fill': `${((v - min) / (max - min)) * 100}%` }) as React.CSSProperties

type Result = { quote: CostQuote; concern: number; best: CostQuote }

export function CostLab({ o, data }: { o: OriginHook; data: OriginReadout }) {
  const [depth, setDepth] = useState(1_000)
  const [headroom, setHeadroom] = useState(100_000)
  const [dev, setDev] = useState(6_000)
  const [mat, setMat] = useState(140)
  const [preset, setPreset] = useState('A')
  const [res, setRes] = useState<Result | null>(null)
  const [sens, setSens] = useState<SensSeries[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const matRay = BigInt(mat) * 10n ** 25n
  const { quote } = o

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      quote(depth, headroom, dev, matRay).then((r) => { if (live) { setRes(r); setErr(null) } }).catch((e: Error) => live && setErr(e.message.split('\n')[0]))
    }, 120)
    return () => { live = false; clearTimeout(t) }
  }, [depth, headroom, dev, matRay, quote])

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      try {
        const series = await Promise.all(DEPTHS.map(async (dd) => ({
          label: dd.label, color: dd.color, dash: dd.dash,
          points: await Promise.all(SENS_D.map(async (d) => {
            const q = (await quote(dd.v, headroom, d * 100, matRay)).quote
            return { d, ratio: q.ratioBps >= 2n ** 255n ? null : Number(q.ratioBps) / 10_000 }
          })),
        })))
        if (live) setSens(series)
      } catch (e) { if (live) setErr((e as Error).message.split('\n')[0]) }
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [headroom, matRay, quote])

  const pick = (p: Preset) => { setPreset(p.id); setDepth(p.depth); setHeadroom(p.headroom); setDev(p.dev); setMat(140) }
  const depthX = sliderFromDepth(depth)
  const minD = Math.max(0, mat - 100)
  const cur = PRESETS.find((p) => p.id === preset)
  const scenario = cur?.scenario ? SCENARIOS.find((s) => s.id === cur.scenario) : undefined
  const q = res?.quote
  const committed = VALIDATION.sensitivity
  const tableRows = useMemo(() => committed?.points.filter((p) => p.headroom === committed.headrooms[0]) ?? [], [committed])

  return (
    <>
      <PageHeader title="Manipulation Cost Lab" sub="Explore how market depth and price inflation change attack economics. Every number below is computed by the deployed ASORiskEngine.quote() — the same code the Sentinel uses."
        tags={<><Badge tone="info" caps square>Modelled · assumption-based</Badge><LiveTag kind="local" /></>} />

      <Card title="Methodology" icon={Calculator} sub="Exactly what src/risk/CostModel.sol computes">
        <div className="pipeline five">
          {[
            { k: 'Price manipulation d', v: 'target inflation', s: 'e.g. +60%', t: 'info' },
            { k: 'Capital', v: 'D × d%', s: 'to move the price', t: 'info' },
            { k: 'Estimated cost', v: 'capital × d × loss share', s: 'lost unwinding', t: 'info' },
            { k: 'Extractable value', v: 'H × (1 − mat/(1+d))', s: 'debt beyond true collateral', t: 'watch' },
            { k: 'Cost / extractable', v: 'cost ÷ extractable', s: 'HIGH < 1× · ELEVATED < 3×', t: 'gold' },
          ].map((n) => <li key={n.k} className={`pnode tone-${n.t}`} style={{ listStyle: 'none' }}><span className="pk">{n.k}</span><span className="pv mono" style={{ fontSize: 13 }}>{n.v}</span><span className="ps">{n.s}</span></li>)}
        </div>
        <div className="g12" style={{ gap: 12 }}>
          <dl className="kv s-6">
            <dt><b>d</b></dt><dd style={{ textAlign: 'left' }}>how much the attacker tries to inflate the price</dd>
            <dt><b>D</b> · <Term t="Market depth" /></dt><dd style={{ textAlign: 'left' }}>assumed capital needed to move the price by 1% — set by governance, not measured</dd>
            <dt><b>H</b> · <Term t="Headroom" /></dt><dd style={{ textAlign: 'left' }}>new debt the attacker could take right now (the Sentinel's FRESH headroom)</dd>
          </dl>
          <dl className="kv s-6">
            <dt><b>loss share</b></dt><dd style={{ textAlign: 'left' }}>assumed share of (capital × move) lost unwinding the position: {data.risk.lossShare / 100}% (contract parameter)</dd>
            <dt><b>mat</b></dt><dd style={{ textAlign: 'left' }}>liquidation ratio ({Number(data.matRay / 10n ** 25n)}% on-chain); profit needs 1 + d &gt; mat, so d must exceed {Number(data.matRay / 10n ** 25n) - 100}%</dd>
            <dt><b>verdict</b></dt><dd style={{ textAlign: 'left' }}>lowest ratio at d₀ + 5, 15, 30 and 60 points (d₀ = mat − 1, where nothing is extractable yet)</dd>
          </dl>
        </div>
      </Card>

      <Card title="Scenario presets" icon={FlaskConical} sub="Load the inputs used by each demo scenario" aside={<button className="btn sm ghost" onClick={() => pick(PRESETS[0])}><RotateCcw size={13} />Reset inputs</button>}>
        <div className="pick-grid" role="group" aria-label="Scenario presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="pick" aria-pressed={preset === p.id} onClick={() => pick(p)}>
              <span className="row"><span className="letter">{p.letter}</span><span className="pt">{p.title}</span></span>
              <span className="pd">{p.desc}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="g12">
        <div className="s-3"><label className="control">
          <span className="ctl-head"><span className="eyebrow"><Term t="Market depth" /></span><span className="ctl-val">${depth.toLocaleString('en-US')}</span></span>
          <input className="range" type="range" min={0} max={1000} value={depthX} style={fill(depthX, 0, 1000)} onChange={(e) => { setDepth(depthFromSlider(+e.target.value)); setPreset('') }} aria-label="Market depth assumption in dollars per 1 percent" />
          <span className="ctl-hint">per 1% price move · log scale $100 – $1M</span>
        </label></div>
        <div className="s-3"><label className="control">
          <span className="ctl-head"><span className="eyebrow">Attacker borrowing H</span><span className="ctl-val">{headroom.toLocaleString('en-US')}</span></span>
          <input className="range" type="range" min={0} max={1_000_000} step={5_000} value={headroom} style={fill(headroom, 0, 1_000_000)} onChange={(e) => { setHeadroom(+e.target.value); setPreset('') }} aria-label="Headroom the attacker could borrow in rwaUSD" />
          <span className="ctl-hint">rwaUSD of headroom available</span>
        </label></div>
        <div className="s-3"><label className="control">
          <span className="ctl-head"><span className="eyebrow">Price inflation d</span><span className="ctl-val">+{(dev / 100).toFixed(0)}%</span></span>
          <input className="range" type="range" min={0} max={20_000} step={100} value={dev} style={fill(dev, 0, 20_000)} onChange={(e) => { setDev(+e.target.value); setPreset('') }} aria-label="Price inflation to evaluate" />
          <span className="ctl-hint">nothing is extractable below +{minD}%</span>
        </label></div>
        <div className="s-3"><label className="control">
          <span className="ctl-head"><span className="eyebrow">Liquidation ratio mat</span><span className="ctl-val">{mat}%</span></span>
          <input className="range" type="range" min={110} max={200} step={5} value={mat} style={fill(mat, 110, 200)} onChange={(e) => { setMat(+e.target.value); setPreset('') }} aria-label="Liquidation ratio" />
          <span className="ctl-hint">what-if only · deployed value 140%</span>
        </label></div>
      </div>

      {err && <Note icon={CircleAlert}>Quote failed: {err}</Note>}
      {!res && !err && <LoadingState>Reading ASORiskEngine.quote()…</LoadingState>}
      {res && q && (
        <div className="g12 stretch">
          <Card className="s-7" title={`At +${(dev / 100).toFixed(0)}% inflation`} icon={Calculator} aside={<LiveTag kind="modelled" />}>
            <div className="result-grid">
              <div className="kpi"><span className="kl">Capital to move the price</span><span className="kv">{usdCompact(q.capitalUsd)}</span><span className="ks">D × d%</span></div>
              <div className="kpi"><span className="kl">Estimated attack cost</span><span className="kv">{usdCompact(q.costUsd)}</span><span className="ks">under the selected depth assumption</span></div>
              <div className="kpi"><span className="kl">Value an attacker could extract</span><span className="kv">{usdCompact(q.extractableUsd)}</span><span className="ks">{Number(q.deviationBps) <= minD * 100 ? 'below the profitable minimum' : 'from headroom H'}</span></div>
              <div className="kpi"><span className="kl"><Term t="Cost / extractable" /></span><span className="kv">{ratio(q.ratioBps)}</span><span className="ks">{q.ratioBps >= 2n ** 255n ? 'nothing to extract' : Number(q.ratioBps) < 10_000 ? 'attack looks profitable' : 'cost exceeds gain'}</span></div>
            </div>
            <CompareBars rows={[
              { label: 'Estimated attack cost', value: toNumber(q.costUsd, 18), text: usdCompact(q.costUsd), tone: 'info' },
              { label: 'Estimated value an attacker could extract', value: toNumber(q.extractableUsd, 18), text: usdCompact(q.extractableUsd), tone: 'watch' },
            ]} />
          </Card>
          <Card className="s-5" title="Cost-gate verdict" icon={TriangleAlert} sub="Most attractive of the evaluated attack sizes" aside={<Badge tone={CONCERN_TONE[res.concern]} caps square>{CONCERN[res.concern]}</Badge>}>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <div className="kpi"><span className="kl">Attack size</span><span className="kv">+{(Number(res.best.deviationBps) / 100).toFixed(0)}%</span></div>
              <div className="kpi"><span className="kl">Ratio</span><span className="kv">{ratio(res.best.ratioBps)}</span></div>
            </div>
            <p className="small t2">{res.concern === 0 ? 'Under the selected governance depth assumption, the model estimates that the attack cost exceeds the value an attacker could extract by at least 3×.' : res.concern === 1 ? 'Under the selected governance depth assumption, the model estimates the attack cost at less than 3× the extractable value: the Sentinel would limit borrowing (WATCH).' : res.concern === 2 ? 'Under the selected governance depth assumption, the model estimates that manipulation is cheaper than what it could extract: the Sentinel would block new borrowing (PROTECTIVE).' : 'No depth assumption: INSUFFICIENT DATA → WATCH.'}</p>
            <Note icon={CircleAlert}>This is a simplified economic proxy — never read LOW as “attack impossible”.</Note>
          </Card>
        </div>
      )}

      <Card title="Sensitivity: cost ÷ extractable across depth assumptions" icon={LineChart} sub={`Live from quote() at H = ${headroom.toLocaleString('en-US')} rwaUSD and mat = ${mat}%. Log scale; below the dashed lines the gate raises a concern.`} aside={<LiveTag kind="modelled" />}>
        {sens ? <SensitivityChart series={sens} /> : <LoadingState>Computing 24 on-chain quotes…</LoadingState>}
        <div className="legend">{DEPTHS.map((dd) => <span key={dd.label}><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke={dd.color} strokeWidth="2.5" strokeDasharray={dd.dash} /></svg>{dd.label}</span>)}</div>
      </Card>

      <div className="g12">
        <Card className="s-7" title="Reproducible sensitivity table" icon={Table2} sub={`From the validation run (${VALIDATION.meta.generatedAt.slice(0, 10)}), H = Sentinel's FRESH headroom, mat 140%`} aside={<LiveTag kind="modelled" />}>
          <div className="table-wrap scroll-y" style={{ maxHeight: 360 }}>
            <table className="table">
              <thead><tr><th>Depth / 1%</th><th>d</th><th className="r">Capital</th><th className="r">Cost</th><th className="r">Extractable</th><th className="r">Ratio</th></tr></thead>
              <tbody>{tableRows.map((p) => <tr key={`${p.depth}-${p.deviationBps}`}><td>${p.depth.toLocaleString('en-US')}</td><td>+{p.deviationBps / 100}%</td><td className="r">{fmt(p.capitalUsd)}</td><td className="r">{fmt(p.costUsd)}</td><td className="r">{fmt(p.extractableUsd)}</td><td className="r">{p.ratio == null ? '∞' : `${p.ratio.toFixed(2)}×`}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card className="s-5" title="What this model does not capture" icon={CircleAlert}>
          <ul className="bullets tone-watch">
            {['Full order-book microstructure and non-linear slippage', 'Multiple venues and cross-venue arbitrage', 'Flash-loan routes and MEV', 'Attacker coordination across markets', 'Liquidation cascades and withdrawal dynamics', 'Real production liquidity (depth is an assumption)'].map((x) => <li key={x}><TriangleAlert size={14} aria-hidden="true" /><span>{x}</span></li>)}
          </ul>
          <p className="small t2">Correct reading: “under the stated assumptions, the modelled attack cost exceeds the modelled extractable value.” Never: “the attack is impossible.”</p>
        </Card>
      </div>

      {scenario && (
        <Card title={`Run scenario ${scenario.title} on the local chain`} icon={Play} sub={scenario.summary}
          aside={<button className="btn primary" disabled={!!o.busy} onClick={() => void o.run(`Scenario ${scenario.title}`, scenario.steps)}>{o.busy ? 'Running…' : <>Run on-chain <ArrowRight size={14} /></>}</button>}>
          <ol className="steps-mini">{scenario.steps.map((s) => <li key={s.title}><span><b style={{ fontWeight: 500 }}>{s.title}.</b> {s.say}</span></li>)}</ol>
          <p className="muted small">Runs real local transactions from the current chain state. Use Reset chain in the top bar to start from the healthy snapshot.</p>
        </Card>
      )}
    </>
  )
}

function fmt(x: number) {
  return x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(0)}`
}
