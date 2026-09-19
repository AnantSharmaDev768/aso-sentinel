import { useCallback, useEffect, useRef, useState } from 'react'
import type { Origin, OriginReadout, ScenarioStep, TxRecord } from '../../../shared/origin-core.mjs'
import { connect, loadDeployment, NetworkMismatchError, RPC_URL, type LocalDeployment } from './chain'

export type ConnStatus = 'loading' | 'no-deployment' | 'no-chain' | 'wrong-network' | 'ready'

export interface LoggedRecord extends TxRecord {
  id: number
  at: number
  context: string
}

const SNAP_KEY = 'origin.snapshotId'
const POLL_MS = 4000

export function useOrigin() {
  const [status, setStatus] = useState<ConnStatus>('loading')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [deployment, setDeployment] = useState<LocalDeployment | null>(null)
  const [data, setData] = useState<OriginReadout | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<LoggedRecord[]>([])
  const originRef = useRef<Origin | null>(null)
  const testRef = useRef<{ revert: (a: { id: `0x${string}` }) => Promise<unknown>; snapshot: () => Promise<`0x${string}`> } | null>(null)
  const contextRef = useRef('')
  const idRef = useRef(0)

  const onTx = useCallback((r: TxRecord) => {
    setLog((l) => [...l, { ...r, id: ++idRef.current, at: Date.now(), context: contextRef.current }].slice(-400))
  }, [])

  const refresh = useCallback(async () => {
    const o = originRef.current
    if (!o) return
    try {
      setData(await o.readAll())
    } catch (e) {
      setError(`Could not read contract state: ${(e as Error).message}`)
    }
  }, [])

  const init = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const dep = await loadDeployment()
    if (!dep) {
      setStatus('no-deployment')
      return
    }
    setDeployment(dep)
    try {
      const { origin, testClient } = await connect(dep, onTx)
      originRef.current = origin
      testRef.current = testClient as unknown as typeof testRef.current
      setStatus('ready')
      setData(await origin.readAll())
    } catch (e) {
      if (e instanceof NetworkMismatchError) {
        setStatus('wrong-network')
        setStatusDetail(e.message)
      } else {
        setStatus('no-chain')
        setStatusDetail(`No local chain at ${RPC_URL} (${(e as Error).message.split('\n')[0]}).`)
      }
    }
  }, [onTx])

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
      try {
        for (const s of steps) {
          contextRef.current = `${context} · ${s.title}`
          await s.run(o)
          setData(await o.readAll())
        }
        return true
      } catch (e) {
        setError(`${contextRef.current}: ${(e as Error).message.split('\n')[0]}`)
        return false
      } finally {
        setBusy(null)
        await refresh()
      }
    },
    [busy, refresh],
  )

  /** Rewind the local chain to the healthy snapshot taken after bootstrap (anvil evm_revert). */
  const reset = useCallback(async () => {
    const tc = testRef.current
    if (!tc || !deployment || busy) return
    setBusy('Reset')
    setError(null)
    try {
      const key = `${SNAP_KEY}.${deployment.deployedAt}` // per deployment: a restarted chain has new snapshots
      let id = (localStorage.getItem(key) as `0x${string}` | null) ?? deployment.snapshotId
      const ok = await tc.revert({ id })
      if (ok === false) throw new Error('snapshot not found — restart `npm run local` to rebuild the demo chain')
      id = await tc.snapshot() // a revert consumes the snapshot; take a new one at the same state
      localStorage.setItem(key, id)
      setLog([])
    } catch (e) {
      setError(`Reset failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
      await refresh()
    }
  }, [busy, deployment, refresh])

  const quote = useCallback(async (depthUsd: number, headroomUsd: number, deviationBps: number) => {
    const o = originRef.current
    if (!o) throw new Error('not connected')
    return o.quote(depthUsd, headroomUsd, deviationBps)
  }, [])

  return { status, statusDetail, deployment, data, busy, error, log, run, reset, refresh, retry: init, quote, clearError: () => setError(null) }
}

export type OriginHook = ReturnType<typeof useOrigin>
