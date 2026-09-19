# Project handoff — Origin // ASO Sentinel

## Purpose
A bounded-loss oracle protection **prototype** for a Multipli-style (MakerDAO-fork) RWA lending market. Multiple oracle
sources agreeing does not mean the market is safe, so Origin separates three questions:

| Layer | Question | Contract |
|---|---|---|
| Verifier | Is the price data authentic and structurally valid? (EIP-712, 3-of-5 quorum, freshness, replay, 1% agreement) | `ASOVerifier` |
| Risk engine | Even if valid, does the market look safe? (TWAP, velocity, weighted median, cost gate) | `ASORiskEngine`, `CostModel`, `WeightedMedian` |
| Sentinel | How much NEW debt may the market create? (sets only the Vat's debt ceiling) | `OriginSentinel` |

It never changes the oracle or collateral price and never blocks repayments.

## V1 vs Origin
- **v1 core** (`ASOVerifier`, `ASOSentinel`): deployed and source-verified on **Sepolia** (12 contracts). Byte-identical to `main`.
- **Origin layer** (`ASORiskEngine`, `OriginSentinel`, libraries): **local anvil only**, not deployed to any public network.
- Multipli's `Vat`, `Spotter`, `OSM`, `PriceFeedAdapter`, `GemJoin5` are vendored byte-identical (`node script/vendor/verify-multipli-sources.mjs`).

## State machine
| State | Borrowing | Debt ceiling | Recovery |
|---|---|---|---|
| FRESH | normal | `min(debt + gap, maxLine, epoch cap)` | — |
| WATCH | limited | same with 25% of gap | automatic when the warning clears |
| DISPUTED | blocked | 0 | via RECOVERING |
| PROTECTIVE | blocked | 0 | via RECOVERING |
| RECOVERING | blocked | 0 | newer accepted round + 1 h delay |

Repayment works in every state. `OriginSentinel.policyLine(state)` exposes the policy on-chain.

## Dashboard (`app/`)
Monitor: Overview, Oracle Monitoring, Sentinel State · Analysis: Baseline vs Protected, Manipulation Cost Lab, Scenarios &
Log · Proof: Validation, Evidence, Presentation Mode. Local demo mode only (anvil test keys, chain 31337, no wallet).

## Simulated / modelled
Five price sources are team test keys; the Chainlink-style feed and RWA token are mocks; time uses anvil time travel;
market depth is a governance assumption; the cost gate is a model; keeper/relayer behaviour is scripted.

## Validation (synthetic, local)
38 main + 19 holdout labelled cases. Final rules: main TP 27 · FN 2 · TN 4 · FP 4 (recall 93.1%, precision 87.1%,
FP rate 50.0%); holdout TP 10 · FN 1 · TN 2 · FP 5. One candidate rule (`vatCheck = GRADED`) was evaluated and rejected;
baseline, candidate and final results are in `validation/`. Report: `docs/VALIDATION.md`.

## Known limitations
Sustained manipulation can enter the TWAP window; small moves stay below thresholds; the cost gate depends on the depth
assumption; a colluding source majority passes the verifier; demo sources are test keys; not audited; not integrated with
Multipli; liquidations and collateral withdrawal are out of scope; no guarantee of zero bad debt.

## Commands
```bash
forge build && forge test                       # 183 tests
python test/mutation/run_mutations.py           # 40 mutants
cd app && npm ci && npm run local               # dashboard at http://localhost:5173
cd app && npm run lint && npm test && npm run build
cd demo && npm ci && npm run demo && npm run demo:origin
cd demo && npm run validate                     # final rules; -- --rules=baseline for the original
```
`npm run demo:sepolia` sends real Sepolia transactions and needs a private, gitignored `.env.sepolia` — do not run casually.

## Final status
Release branch `feat/ui-redesign`: all tests, builds, demos and validation pass; dashboard verified in the browser at
desktop, tablet and mobile widths; Sepolia evidence re-checked on-chain (12 contracts have code, 17 recorded
transactions exist). See `docs/AI_CONTEXT.md` for continuation notes.
