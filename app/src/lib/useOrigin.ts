import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicClient } from 'viem'
import type { Origin, OriginReadout, ScenarioStep, TxRecord } from '../../../shared/origin-core.mjs'
import { connect, loadDeployment, NetworkMismatchError, RPC_URL, type LocalDeployment } from './chain'
import { readEvents, type ChainEvent } from './events'

export type ConnStatus = 'loading' | 'no-deployment' | 'no-chain' | 'wrong-network' | 'ready'

export interface LoggedRecord extends TxRecord {
  id: number
  at: number
  context: string
}

/** A user-facing error: short title, what happened, the decoded reason and the raw detail. */
export interface AppError {
  title: string
  message: string
  reason?: string
  detail?: string
}

/** Progress of the action in flight, driven by real events: a tx is being sent, one was mined, state is being read. */
export interface Activity {
  context: string
  step: string
  phase: 'tx' | 'reading'
  txCount: number
  last: LoggedRecord | null
}

const SNAP_KEY = 'origin.snapshotId'
const POLL_MS = 4000

function toAppError(title: string, context: string, e: unknown): AppError {
  const raw = e instanceof Error ? e.message : String(e)
  const first = raw.split('\n')[0]
  const m = raw.match(/reverted with the following reason:\s*\n?\s*(.+)/i) ?? raw.match(/reason:\s*(.+)/i)
  return { title, message: context, reason: m ? m[1].trim() : first, detail: raw.length > first.length ? raw : undefined }
}

export function useOrigin() {
  const [status, setStatus] = useState<ConnStatus>('loading')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [deployment, setDeployment] = useState<LocalDeployment | null>(null)
  const [data, setData] = useState<OriginReadout | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [log, setLog] = useState<LoggedRecord[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [events, setEvents] = useState<ChainEvent[]>([])
  const [lastReadAt, setLastReadAt] = useState<number | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const originRef = useRef<Origin | null>(null)
  const clientRef = useRef<PublicClient | null>(null)
  const depRef = useRef<LocalDeployment | null>(null)
  const testRef = useRef<{ revert: (a: { id: `0x${string}` }) => Promise<unknown>; snapshot: () => Promise<`0x${string}`> } | null>(null)
  const contextRef = useRef('')
  const idRef = useRef(0)
  const eventsBlockRef = useRef<bigint>(-1n)

  const onTx = useCallback((r: TxRecord) => {
    const rec: LoggedRecord = { ...r, id: ++idRef.current, at: Date.now(), context: contextRef.current }
    setLog((l) => [...l, rec].slice(-400))
    setActivity((a) => (a ? { ...a, txCount: a.txCount + (r.kind === 'tx' ? 1 : 0), last: r.quiet && r.pass ? a.last : rec } : a))
  }, [])

  const loadEvents = useCallback(async (block: bigint, force = false) => {
    const c = clientRef.current
    const dep = depRef.current
    if (!c || !dep || (!force && block === eventsBlockRef.current)) return
    eventsBlockRef.current = block
    try {
      setEvents(await readEvents(c, dep))
    } catch {
      eventsBlockRef.current = -1n // retry on the next refresh; the event feed is supplementary
    }
  }, [])

  const readNow = useCallback(async (o: Origin) => {
    const r = await o.readAll()
    setData(r)
    setLastReadAt(Date.now())
    setReadFailed(false)
    void loadEvents(r.chain.block)
    return r
  }, [loadEvents])

  const refresh = useCallback(async () => {
    const o = originRef.current
    if (!o) return
    try {
      await readNow(o)
    } catch (e) {
      setReadFailed(true)
      setError(toAppError('Could not read contract state', 'Reading OriginSentinel.snapshot() and related views failed.', e))
    }
  }, [readNow])

  const init = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const dep = await loadDeployment()
    if (!dep) {
      setStatus('no-deployment')
      return
    }
    setDeployment(dep)
    depRef.current = dep
    try {
      const { origin, testClient, publicClient } = await connect(dep, onTx)
      originRef.current = origin
      clientRef.current = publicClient as unknown as PublicClient
      testRef.current = testClient as unknown as typeof testRef.current
      await readNow(origin)
      setStatus('ready')
    } catch (e) {
      if (e instanceof NetworkMismatchError) {
        setStatus('wrong-network')
        setStatusDetail(e.message)
      } else {
        setStatus('no-chain')
        setStatusDetail(`No local chain at ${RPC_URL} (${(e as Error).message.split('\n')[0]}).`)
      }
    }
  }, [onTx, readNow])

  useEffect(() => {
    const t = setTimeout(() => void init(), 0) // connect after mount, outside the render/effect phase
    return () => clearTimeout(t)
  }, [init])

  useEffect(() => {
    if (status !== 'ready' || busy) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [status, busy, refresh])

  /** Run steps as real local transactions; stops at the first thrown error and reports it. */
  const run = useCallback(
    async (context: string, steps: ScenarioStep[]) => {
      const o = originRef.current
      if (!o || busy) return false
      setBusy(context)
      setError(null)
      contextRef.current = context
      setActivity({ context, step: steps[0]?.title ?? context, phase: 'tx', txCount: 0, last: null })
      try {
        for (const s of steps) {
          contextRef.current = `${context} · ${s.title}`
          setActivity((a) => (a ? { ...a, step: s.title, phase: 'tx' } : a))
          await s.run(o)
          setActivity((a) => (a ? { ...a, phase: 'reading' } : a))
          await readNow(o)
        }
        return true
      } catch (e) {
        setError(toAppError('Transaction step failed', contextRef.current, e))
        return false
      } finally {
        setBusy(null)
        setActivity(null)
        await refresh()
      }
    },
    [busy, refresh, readNow],
  )

  /** Rewind the local chain to the healthy snapshot taken after bootstrap (anvil evm_revert). */
  const reset = useCallback(async () => {
    const tc = testRef.current
    if (!tc || !deployment || busy) return
    setBusy('Reset')
    setError(null)
    try {
      const key = `${SNAP_KEY}.${deployment.deployedAt}` // per deployment: a restarted chain has new snapshots
      let id: `0x${string}` = deployment.snapshotId
      try {
        id = (localStorage.getItem(key) as `0x${string}` | null) ?? id
      } catch { /* storage unavailable: fall back to the deployment snapshot */ }
      const ok = await tc.revert({ id })
      if (ok === false) throw new Error('snapshot not found — restart `npm run local` to rebuild the demo chain')
      id = await tc.snapshot() // a revert consumes the snapshot; take a new one at the same state
      try {
        localStorage.setItem(key, id)
      } catch { /* non-persistent storage: resets in this tab keep working via the returned id next time */ }
      setLog([])
      eventsBlockRef.current = -1n
    } catch (e) {
      setError(toAppError('Reset failed', 'Could not rewind the local chain to the healthy snapshot.', e))
    } finally {
      setBusy(null)
      await refresh()
    }
  }, [busy, deployment, refresh])

  const quote = useCallback(async (depthUsd: number, headroomUsd: number, deviationBps: number, matRay?: bigint) => {
    const o = originRef.current
    if (!o) throw new Error('not connected')
    return o.quote(depthUsd, headroomUsd, deviationBps, matRay)
  }, [])

  return {
    status, statusDetail, deployment, data, busy, error, log, activity, events, lastReadAt, readFailed,
    run, reset, refresh, retry: init, quote, clearError: () => setError(null),
  }
}

export type OriginHook = ReturnType<typeof useOrigin>
