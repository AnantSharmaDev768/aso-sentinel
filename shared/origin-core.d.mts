// Type declarations for shared/origin-core.mjs (the engine is plain ESM so Node and Vite share it).

export declare const LOCAL_CHAIN_ID: 31337;
export declare const STATE: readonly ["FRESH", "WATCH", "DISPUTED", "PROTECTIVE", "RECOVERING"];
export declare const VERIFIER_STATUS: readonly ["NO_DATA", "OK", "STALE", "DISPUTED", "HALTED"];
export declare const CONCERN: readonly ["LOW CONCERN", "ELEVATED", "HIGH CONCERN", "INSUFFICIENT DATA"];
export declare const HOUR: bigint;

export interface FlagDef {
  bit: number;
  key: string;
  level: "protect" | "watch" | "disputed";
  label: string;
  explain: string;
}
export declare const FLAGS: FlagDef[];
export declare function decodeFlags(flags: number | bigint): FlagDef[];
export declare function usdToWad(usd: number | bigint): bigint;

export interface TxRecord {
  kind: "tx" | "check";
  network: "local-anvil";
  label: string;
  hash?: `0x${string}`;
  block?: number;
  status?: "success" | "reverted";
  reason?: string | null;
  expect?: "success" | "revert";
  expectReason?: string | null;
  actual?: string;
  pass: boolean;
  check?: string | null;
  quiet?: boolean;
}

export interface CostQuote {
  deviationBps: bigint;
  capitalUsd: bigint;
  costUsd: bigint;
  extractableUsd: bigint;
  ratioBps: bigint;
}

export interface Snapshot {
  state: number;
  previousState: number;
  stateSince: bigint;
  target: number;
  flags: number;
  line: bigint;
  debt: bigint;
  vatPrice: bigint;
  attestedPrice: bigint;
  effectivePrice: bigint;
  twap: bigint;
  twapOk: boolean;
  twapCoverageBps: bigint;
  twapDeviationBps: bigint;
  velocityBpsPerHour: bigint;
  velocityOk: boolean;
  concern: number;
  costQuote: CostQuote;
  freshHeadroom: bigint;
  epochStart: bigint;
  epochStartDebt: bigint;
  epochCapLine: bigint;
  restrictedAtNonce: bigint;
  recoveryRoundSeen: boolean;
  recoveryReadyAt: bigint;
}

export interface SourceRow {
  index: number;
  address: `0x${string}`;
  weight: number;
  price: bigint;
  validAfter: bigint;
  nonce: bigint;
  authorised: boolean;
}

export interface Urn {
  ink: bigint;
  art: bigint;
}

export interface OriginReadout {
  snapshot: Snapshot;
  limits: readonly [bigint, bigint, number, number];
  thresholds: readonly [number, number, number, number, number, number];
  epochConfig: readonly [bigint, bigint];
  verifier: { status: number; price: bigint; lastNonce: bigint; lastAcceptedNonce: bigint; observedAt: bigint; expiresAt: bigint; maxAge: bigint; quorum: bigint };
  risk: {
    depth: bigint; depthAt: bigint; maxDepthAge: number; twapWindow: number; minCoverage: number;
    weightedNonce: bigint; weightedMedian: bigint; weightedSourceCount: number; storedObservations: number;
    observations: { price: bigint; timestamp: bigint; nonce: bigint }[];
    lossShare: number; elevatedRatio: number; highRatio: number;
  };
  sources: SourceRow[];
  /** OriginSentinel.policyLine(state) for FRESH, WATCH, DISPUTED, PROTECTIVE, RECOVERING [rad] */
  policy: bigint[];
  baseline: { Art: bigint; rate: bigint; spot: bigint; line: bigint; dust: bigint; debt: bigint; headroomWad: bigint; costBest: CostQuote; concern: number };
  protectedVat: { Art: bigint; rate: bigint; spot: bigint; line: bigint; dust: bigint; debt: bigint };
  feed: { answer: bigint; updatedAt: bigint };
  adapterValid: boolean;
  osm: { value: bigint; has: boolean };
  matRay: bigint;
  urns: Record<"alice" | "bob" | "mallory", { baseline: Urn; protected: Urn }>;
  chain: { timestamp: bigint; block: bigint };
}

export interface Origin {
  D: Record<string, `0x${string}`> & { ilk: `0x${string}`; profileId: `0x${string}` };
  records: TxRecord[];
  readAll(): Promise<OriginReadout>;
  readState(): Promise<number>;
  quote(depthUsd: number, headroomUsd: number, deviationBps: number, matRay?: bigint): Promise<{ quote: CostQuote; concern: number; best: CostQuote; matRay: bigint }>;
  probe(who: unknown, which: 'baseline' | 'protected', amount: number, sign: 1 | -1): Promise<{ ok: boolean; reason: string | null }>;
  bootstrap(): Promise<void>;
  warp(seconds: bigint | number): Promise<void>;
  poke(opt?: object): Promise<TxRecord>;
  assertLocal(): Promise<void>;
  [k: string]: unknown;
}

export interface ScenarioStep {
  title: string;
  say: string;
  run: (o: Origin) => Promise<void>;
}
export interface Scenario {
  id: string;
  title: string;
  summary: string;
  steps: ScenarioStep[];
}
export declare const SCENARIOS: Scenario[];
export declare const PRESENTATION: ScenarioStep[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function createOrigin(p: any): Origin;
