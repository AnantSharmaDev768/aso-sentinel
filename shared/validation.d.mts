// Type declarations for shared/validation.mjs.
import type { Origin } from './origin-core.mjs'

export type Truth = 'risk' | 'healthy' | 'degraded'
export type Outcome = 'TP' | 'FN' | 'TN' | 'FP' | 'MATCH' | 'MISMATCH'

export interface CaseDef {
  id: string
  group: string
  truth: Truth
  title: string
  description: string
  required: 'reject' | 'blocked' | 'limited' | 'none'
  expected: string
  expectedState?: string
  trigger: string
  sources: { online: number; manipulated: number; note?: string }
  run: (o: Origin, c: unknown) => Promise<void>
}

export interface Observation {
  label: string
  t: number
  block: number
  tx: string
  state: string
  stateIdx: number
  target: string
  flags: string[]
  line: string
  debt: string
  headroom: string
  borrowOk: boolean
  borrowReason: string | null
  repayOk: boolean
  baselineBorrowOk: boolean
  transition: string
  transitionOk: boolean
  invariants: Record<string, boolean>
  phase?: 'before' | 'risk' | 'after'
}

export interface CaseResult {
  id: string
  group: string
  truth: Truth
  title: string
  description: string
  trigger: string
  sources: { online: number; manipulated: number; note?: string }
  required: CaseDef['required']
  expected: string
  expectedState: string | null
  lastPrices: number[] | null
  actual: {
    finalState: string | null
    finalPolicy: string | null
    finalLine: string | null
    finalDebt: string | null
    finalHeadroom: string | null
    statesSeen: string[]
    borrowProbeFinal: boolean | null
    repayProbeFinal: boolean | null
    baselineBorrowFinal: boolean | null
    acceptedRounds: number
  }
  outcome: Outcome
  detected: boolean | null
  lapsed: boolean
  latencySeconds: number | null
  latencyNote: string | null
  restriction: { pokes: number; of: number; worst: string; causes: string[]; blockedPokes: number; returnedToFresh: boolean } | null
  rejections: { label: string; expected: string; reverted: boolean; reason: string | null; pass: boolean; tx?: string; block?: number }[]
  checks: { label: string; pass: boolean; actual: string }[]
  invariantViolations: string[]
  transitions: string[]
  transitionViolations: string[]
  pokes: number
  observations: Observation[]
  error: string | null
  pass: boolean
  harnessNotes?: string[]
}

export interface Summary {
  total: number
  risk: number
  healthy: number
  degraded: number
  TP: number
  FN: number
  TN: number
  FP: number
  degradedMatch: number
  degradedMismatch: number
  healthyPokes: number
  healthyRestrictedPokes: number
  healthyBlockedPokes: number
  precision: number | null
  recall: number | null
  falsePositiveRate: number | null
  verifierRejections: number
  latency: { cases: number; min: number; median: number; max: number } | null
  pokes: number
  invariantChecks: number
  invariantViolations: number
  transitions: number
  transitionViolations: number
  errors: number
  passed: number
}

export declare const CASES: CaseDef[]
export declare const HOLDOUT: CaseDef[]
export declare const POLICY_TEXT: string[]
export declare function runCase(o: Origin, def: CaseDef, opts?: { onProgress?: (o: Observation) => void }): Promise<CaseResult>
export declare function summarize(results: CaseResult[]): Summary
