// Reads the protocol's own event logs from the local chain (no invented history): accepted and disputed
// rounds, Sentinel state changes, governance depth updates and borrow/repay on both Vats.
import type { PublicClient } from 'viem'
import abis from '../../../shared/abis.json'
import { STATE, decodeFlags } from '../../../shared/origin-core.mjs'
import type { LocalDeployment } from './chain'
import { localAccounts } from './chain'
import { RAY, toNumber, usd } from './format'

export type EventKind = 'round' | 'disputed' | 'state' | 'depth' | 'borrow' | 'repay' | 'halt'

export interface ChainEvent {
  key: string
  kind: EventKind
  block: bigint
  time: bigint // chain time (seconds)
  title: string
  detail?: string
  toState?: number
  fromState?: number
  flags?: string[]
  nonce?: bigint
  price?: bigint
  txHash: `0x${string}`
  logIndex: number
}

type Log = { blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number; eventName: string; args: Record<string, unknown> }

const blockTimes = new Map<bigint, bigint>()

function actorName(addr: string): string {
  const a = localAccounts()
  const map: Record<string, string> = { [a.alice.address.toLowerCase()]: 'Alice', [a.bob.address.toLowerCase()]: 'Bob', [a.mallory.address.toLowerCase()]: 'Mallory' }
  return map[addr.toLowerCase()] ?? `${addr.slice(0, 8)}…`
}

const rwaAmount = (dart: bigint, rate: bigint) => Math.round(toNumber(((dart < 0n ? -dart : dart) * rate) / RAY, 18)).toLocaleString('en-US')

export async function readEvents(client: PublicClient, dep: LocalDeployment): Promise<ChainEvent[]> {
  const get = (address: string, abi: unknown) =>
    client.getContractEvents({ address: address as `0x${string}`, abi: abi as never, fromBlock: 0n }) as unknown as Promise<Log[]>
  const [ver, sen, risk, pVat, bVat] = await Promise.all([
    get(String(dep.verifier), abis.verifier),
    get(String(dep.sentinel), abis.sentinel),
    get(String(dep.riskEngine), abis.riskEngine),
    get(String(dep.protectedVat), abis.vat),
    get(String(dep.baselineVat), abis.vat),
  ])

  const out: Omit<ChainEvent, 'time'>[] = []
  const base = (l: Log) => ({ key: `${l.transactionHash}:${l.logIndex}`, block: l.blockNumber, txHash: l.transactionHash, logIndex: l.logIndex })

  for (const l of ver) {
    const a = l.args
    if (l.eventName === 'RoundAccepted') out.push({ ...base(l), kind: 'round', title: `Oracle round #${String(a.nonce)} accepted`, detail: `median ${usd(a.median as bigint)}`, nonce: a.nonce as bigint, price: a.median as bigint })
    else if (l.eventName === 'RoundDisputed') out.push({ ...base(l), kind: 'disputed', title: `Oracle round #${String(a.nonce)} DISPUTED`, detail: `sources spread ${(Number(a.spreadBps) / 100).toFixed(2)}% (${usd(a.minPrice as bigint)} – ${usd(a.maxPrice as bigint)})`, nonce: a.nonce as bigint, price: a.median as bigint })
    else if (l.eventName === 'Halted') out.push({ ...base(l), kind: 'halt', title: 'Verifier halted by guardian' })
    else if (l.eventName === 'Unhalted') out.push({ ...base(l), kind: 'halt', title: 'Verifier unhalted' })
  }
  for (const l of sen) {
    if (l.eventName !== 'StateChanged') continue
    const from = Number(l.args.from)
    const to = Number(l.args.to)
    out.push({ ...base(l), kind: 'state', title: `Sentinel ${STATE[from]} → ${STATE[to]}`, toState: to, fromState: from, flags: decodeFlags(l.args.flags as number).map((f) => f.key) })
  }
  for (const l of risk) {
    if (l.eventName !== 'MarketDepthSet') continue
    out.push({ ...base(l), kind: 'depth', title: 'Governance set the market-depth assumption', detail: `$${Math.round(toNumber(l.args.depthUsdPer1Pct as bigint, 18)).toLocaleString('en-US')} per 1%` })
  }
  const frobs = (logs: Log[], market: string) => {
    for (const l of logs) {
      if (l.eventName !== 'Frob' || l.args.ilk !== dep.ilk) continue
      const dart = l.args.dart as bigint
      if (dart === 0n) continue
      const who = actorName(String(l.args.u))
      out.push({ ...base(l), kind: dart > 0n ? 'borrow' : 'repay', title: `${who} ${dart > 0n ? 'borrowed' : 'repaid'} ${rwaAmount(dart, l.args.rate as bigint)} rwaUSD`, detail: `${market} Vat` })
    }
  }
  frobs(pVat, 'protected')
  frobs(bVat, 'baseline')

  const missing = [...new Set(out.map((e) => e.block))].filter((b) => !blockTimes.has(b))
  await Promise.all(missing.map(async (b) => blockTimes.set(b, (await client.getBlock({ blockNumber: b })).timestamp)))

  return out
    .map((e) => ({ ...e, time: blockTimes.get(e.block) ?? 0n }))
    .sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1))
}
