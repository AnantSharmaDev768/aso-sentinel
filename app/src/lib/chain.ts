import { createPublicClient, createTestClient, createWalletClient, http, type Account } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import abis from '../../../shared/abis.json'
import { createOrigin, LOCAL_CHAIN_ID, type Origin, type TxRecord } from '../../../shared/origin-core.mjs'

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'

/** anvil is started with --timestamp 1_800_000_000 (app/scripts/local.mjs); chain time is shown relative to it. */
export const SIM_START = 1_800_000_000
export function simTime(ts: bigint | number, fmt: (s: number) => string): string {
  return `T+${fmt(Math.max(0, Number(ts) - SIM_START))}`
}

// anvil's PUBLIC default test keys. Used only against a local anvil chain (chain id 31337); the dashboard
// refuses to send transactions anywhere else. They are not secrets and must never hold real funds.
const LOCAL_TEST_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
] as const

export function localAccounts() {
  const k = LOCAL_TEST_KEYS.map((x) => privateKeyToAccount(x))
  return {
    admin: k[0], feeder: k[1], alice: k[2], mallory: k[3], bob: k[4],
    sources: k.slice(5).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)),
    outsider: privateKeyToAccount(`0x${'11'.repeat(32)}`),
  }
}

export interface LocalDeployment {
  chainId: number
  snapshotId: `0x${string}`
  deployedAt: string
  ilk: `0x${string}`
  profileId: `0x${string}`
  maxValidity: number
  [contract: string]: string | number
}

/** Written by `npm run local` (app/scripts/local.mjs) after deploying and bootstrapping. */
export async function loadDeployment(): Promise<LocalDeployment | null> {
  try {
    const r = await fetch('/deployment.local.json', { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as LocalDeployment
  } catch {
    return null
  }
}

export class NetworkMismatchError extends Error {
  readonly chainId: number
  constructor(chainId: number) {
    super(`Connected to chain ${chainId}; this dashboard only sends transactions to local anvil (${LOCAL_CHAIN_ID}).`)
    this.chainId = chainId
  }
}

export async function connect(dep: LocalDeployment, onTx: (r: TxRecord) => void) {
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL), pollingInterval: 100 })
  const chainId = await publicClient.getChainId() // throws if the RPC is unreachable
  if (chainId !== LOCAL_CHAIN_ID) throw new NetworkMismatchError(chainId)
  const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport: http(RPC_URL) })
  const walletFor = (account: Account) => createWalletClient({ account, chain: foundry, transport: http(RPC_URL) })
  const origin: Origin = createOrigin({ publicClient, testClient, walletFor, deployment: dep, abis, accounts: localAccounts(), onTx })
  return { origin, publicClient, testClient }
}
