# Origin: risk engine, cost gate and state machine

This document specifies the Origin layer: what each contract computes, the exact formulas and default
parameters, and what is enforced on-chain versus what the dashboard only explains. Default values come from
`defaultOriginConfig()` in [script/OriginDeployer.sol](../script/OriginDeployer.sol).

> **Scope.** Origin (`ASORiskEngine`, `OriginSentinel`, `WeightedMedian`, `CostModel`) runs **only on a local
> anvil chain** and in `forge test`. The Sepolia deployment described in [SEPOLIA.md](SEPOLIA.md) contains the
> v1 core only (`ASOVerifier`, `ASOSentinel` and the Multipli stack). Origin has not been audited.

## 1. Data flow

```
5 signed sources ─► ASOVerifier (EIP-712, 3-of-5, nonce, expiry, 1% agreement) ─► accepted rounds
                                     │
                     ASORiskEngine.sync() ─► ring buffer (32 observations)
                     ASORiskEngine.recordSources(...) ─► weighted median (optional, per round)
                                     │
OriginSentinel.poke():  sync → assess (flags) → roll epoch → state transition → vat.file(ilk, "line", x)
```

`OriginSentinel` never changes a collateral price. Its only write to the Vat is the debt ceiling `line`.
Repayments are never blocked, because the Vat skips the ceiling check when debt decreases.

**Relayer duty:** call `riskEngine.sync()` after each `submitRound` (or let the next `poke()` do it). The TWAP
only sees rounds that were synced, and a round that gets overwritten before any sync is never recorded. The demo
runner and the dashboard both sync after every round.

## 2. Risk engine signals (`ASORiskEngine`)

| Signal | Formula | Default |
|---|---|---|
| Observation | `(price, observedAt, nonce)` of each newly accepted verifier round | ring buffer of 32 |
| TWAP | time-weighted mean of observations over the last `twapWindow`; each price is held until the next observation, and the last one is held until `now` | window 6 h |
| TWAP coverage | covered time ÷ window. The TWAP is reported valid (`ok`) only if coverage ≥ `minCoverageBps` | 50% |
| Spot deviation | `|attested − TWAP| / TWAP` in bps | — |
| Velocity | `|p₁ − p₀| / p₀` per hour between the two latest observations; invalid if they are closer than `minVelocityInterval` | 60 s |
| Effective price | `min(attested, TWAP)` when the TWAP is valid, otherwise the attested price | — |
| Weighted median | lower weighted median of the per-source prices of the latest accepted round, re-verified from signatures. Weights are **configured by governance, not measured** | 30/25/20/15/10 % |

## 3. Manipulation-cost gate (`CostModel`)

This is a transparent **proxy**, not a market model. It asks whether pushing the price far enough to make
over-borrowing profitable would plausibly cost more than the attacker could extract.

Inputs:

- `D`: the governance-set **depth assumption**, in USD needed to move the price by 1%. It is not measured
  liquidity. Default: $250,000 per 1%.
- `H`: extractable headroom, which is `freshHeadroom()`, the new debt the FRESH state would allow right now.
- `mat` = 140%.
- `lossShare` = 50%.

For a price inflation `d` (as a fraction):

```
capital(d)     = D × (d / 1%)                   capital needed to move the price
cost(d)        = capital(d) × d × lossShare     expected loss unwinding the position
extractable(d) = H × max(0, 1 − mat / (1 + d))  bad debt the headroom allows at the inflated price
ratio(d)       = cost(d) / extractable(d)
```

With `d₀ = mat − 1` (the minimum profitable inflation, 40% at mat 140%), the gate evaluates d₀ + 5, 15, 30 and
60 percentage points (45%, 55%, 70%, 100%) — d₀ itself is not evaluated because nothing is extractable there —
and uses the **lowest** ratio:

| Concern | Condition | Sentinel effect |
|---|---|---|
| LOW | ratio ≥ 3× | none |
| ELEVATED | 1× ≤ ratio < 3× | WATCH |
| HIGH | ratio < 1× | PROTECTIVE |
| INSUFFICIENT_DATA | depth unset or older than `maxDepthAge` (7 days) | WATCH |

Implementation note: the current implementation applies the price-move factor d to the assumed unwind loss
(`cost = capital × d × lossShare`). This release preserves the tested implementation.

Assumptions and limits:

- Depth is a single number supplied by governance. A stale value degrades to INSUFFICIENT_DATA; it is never
  silently reused.
- The formula ignores funding, cross-venue arbitrage, flash liquidity and the attacker's own collateral cost.
- **It is not proof of safety.** It only makes the economic question explicit and auditable.

## 4. Flags and target state (`OriginSentinel.assess`)

| Flag | Raised when | Class |
|---|---|---|
| `ASO_HALTED`, `ASO_NO_DATA`, `ASO_STALE` | verifier status | PROTECT |
| `ASO_DISPUTED` | verifier status DISPUTED | → DISPUTED |
| `FEED_STALE` | Multipli `PriceFeedAdapter.peek()` returns `has=false` or reverts | PROTECT |
| `VAT_ABOVE_EFFECTIVE` | Vat price > min(attested, TWAP) × (1 + 2%) — the explicit conservative-valuation rule (default `vatCheck = CONSERVATIVE`; see §10) | PROTECT |
| `TWAP_DEVIATION_PROTECT` / `_WATCH` | spot deviation ≥ 15% / ≥ 3% | PROTECT / WATCH |
| `VELOCITY_PROTECT` / `_WATCH` | velocity ≥ 20%/h / ≥ 5%/h | PROTECT / WATCH |
| `COST_HIGH` / `COST_ELEVATED` / `COST_NO_DATA` | cost gate (section 3) | PROTECT / WATCH / WATCH |
| `TWAP_INSUFFICIENT` | TWAP coverage below 50% | WATCH |
| `SOURCE_DIVERGENCE` | weighted median differs from the verifier's median by ≥ 0.5% (only when `recordSources` covered the latest round) | WATCH |
| `SOURCE_COVERAGE_MIN` | the latest round's per-source record holds only the minimum quorum of sources (e.g. 3 of 5): no redundancy left | WATCH |
| `VAT_ABOVE_TWAP` | only in the evaluated, non-default `GRADED` mode: Vat price > TWAP × (1 + 3% watch band) | WATCH |

Target mapping: `ASO_DISPUTED` → DISPUTED; else any PROTECT flag → PROTECTIVE; else any WATCH flag → WATCH;
else FRESH. Market signals are skipped until the first accepted round exists.

## 5. State machine (`OriginSentinel.poke`)

```
            ┌──────────── restricted target (DISPUTED / PROTECTIVE) from any state ────────────┐
            ▼                                                                                   │
 FRESH ◄──► WATCH        DISPUTED / PROTECTIVE ──(target healthy)──► RECOVERING ──(new accepted round
                                                                         AND recoveryDelay elapsed)──► FRESH or WATCH
```

- The contract is deployed in PROTECTIVE (fail closed).
- There is **no direct PROTECTIVE/DISPUTED → FRESH transition**. Recovery requires `lastAcceptedNonce >
  restrictedAtNonce` **and** `recoveryDelay` (1 h) spent in RECOVERING. `restrictedAtNonce` is refreshed on every
  restricted poke, so the round that ends an incident must be newer than the last bad observation.
- While RECOVERING, a restricted target sends the state straight back to DISPUTED/PROTECTIVE.
- Every transition emits `StateChanged(from, to, flags)`. The `snapshot()` view returns every value the
  dashboard shows.

## 6. Debt ceiling per state

| State | `line` |
|---|---|
| FRESH | `min(debt + gap, maxLine, epochStartDebt + growthCap)` |
| WATCH | the same, with `gap × watchGapBps` (25%) in place of `gap` |
| DISPUTED / PROTECTIVE / RECOVERING | `0` |

The policy is machine-readable: `OriginSentinel.policyLine(state)` returns the ceiling the Sentinel would set in
each state right now, from the same function `poke()` applies. `test/OriginPolicy.t.sol` proves each row: FRESH
permits normal borrowing, WATCH strictly reduces headroom but still allows borrowing, DISPUTED/PROTECTIVE freeze,
RECOVERING stays frozen until a newer round and the delay (and re-restricts on relapse), repayments succeed in every
restricted state, and no restricted state can raise capacity (fuzzed over existing debt).

Defaults: `gap` 200,000 rwaUSD; `maxLine` 1,000,000; `growthCap` 100,000 rwaUSD per 1-day epoch. Epochs are
aligned to whole multiples of the duration from deployment, and `epochStartDebt` is taken at the first poke of
each epoch. The epoch cap bounds how much new debt any single day can add, even in FRESH. That limits the loss
if an attack is sustained long enough to become the TWAP (section 8).

## 7. Weakest link (dashboard analytics)

The dashboard computes a *utilization* for each dimension: `0` means no pressure, `1` means the PROTECTIVE
threshold is reached, and `>1` means it is exceeded. The weakest link is the dimension with the highest
utilization. Implementation: [app/src/lib/risk.ts](../app/src/lib/risk.ts).

| Dimension | Utilization |
|---|---|
| Oracle freshness | age ÷ `maxAge` |
| TWAP deviation | deviation ÷ 15% (n/a when coverage is insufficient) |
| Velocity | velocity ÷ 20%/h (n/a with fewer than two usable observations) |
| Manipulation cost | 1× ÷ (cost ÷ extractable); 0 if nothing is extractable; n/a without depth |
| Source divergence | divergence ÷ 0.5%; 1 when DISPUTED |
| Borrowing growth | net debt growth this epoch ÷ `growthCap` |
| Multipli feed, Vat vs effective price | binary (0 or 1) |

**Authoritative vs analytics.** The state, the flags, the `line`, the prices, the TWAP, velocity, the cost
quote and the epoch figures are all read from the contracts (`OriginSentinel.snapshot()` and
`ASORiskEngine.quote()`). The weakest-link ranking, the utilization bars, the colour tones and the
bad-debt estimate in "Baseline vs protected" are computed in the browser for explanation only; nothing
on-chain depends on them.

## 8. Known limitations (Origin-specific)

1. **Sustained manipulation becomes the TWAP.** A price held for longer than the TWAP window stops looking
   like a deviation (scenario B, `test_B_SustainedSqueeze…`). What bounds the loss is the WATCH headroom and
   the epoch growth cap, not detection.
2. **Depth and weights are assumptions.** Nothing measures liquidity or source quality on-chain. A wrong
   depth figure makes the cost gate wrong in the same direction.
3. **Keeper and relayer dependency.** Signals only act when someone calls `poke()`. Between pokes, exposure
   is bounded by the `line` set at the last poke.
4. **Vault and collateral integrity checks (donation or share-price inflation) are not implemented.**
   Multipli's Vat does not expose total collateral per ilk, so such a check cannot be expressed against the
   current interfaces. This is future work, and the dashboard does not show it as active.
5. **Collateral withdrawal at a stale-high price** is still possible. This is inherited from v1; see the
   README.
6. **No keeper incentives, no audit, no Multipli integration.** Governance would have to `rely` the
   Sentinel on the Vat.

## 9. Evidence

- `forge test`: suites `RiskLibraries` (18), `ASORiskEngine` (22), `OriginSentinel` (25), `OriginPolicy` (21),
  `OriginScenarios` (5), plus the `OriginInvariants` suite. That suite is one invariant test that checks 8
  properties over random call sequences, including a handler that performs honest recovery so borrowing is
  actually exercised.
- `test/mutation/run_mutations.py`: 23 Origin mutants, out of 40 in total.
- `cd demo && npm run validate`: the labelled validation suite (38 main + 19 holdout cases) with TP/FN/TN/FP,
  latency, invariant and transition checks — see [VALIDATION.md](VALIDATION.md).
- `npm run demo:origin` (in `demo/`) runs every item on a fresh anvil chain as mined transactions and exits
  non-zero on any unexpected outcome.

## 10. The Vat price rule (`vatCheck`) and why it was not changed

`VAT_ABOVE_EFFECTIVE` compares the Vat's lending price with min(attested, 6 h TWAP): *the Vat must not lend more than
2% above the conservative valuation*. Validation showed it is the main source of restrictions in honest trending
markets, so an alternative (`GRADED`: freeze only on Vat vs current market + 2%, and WATCH on Vat vs TWAP beyond the
3% band) was implemented behind `setVatCheck` and evaluated on the main and a separate holdout suite. It changed no
TP/FN/TN/FP count, removed about two frozen hours per honest rally, and removed the same two frozen hours during
sustained manipulations. Under a bounded-loss priority that is not an improvement, so the default stays
`CONSERVATIVE`. `GRADED` is kept only so the comparison is reproducible (`npm run validate -- --rules=candidate-graded`).
Details and per-case analysis: [VALIDATION.md §2 and §7](VALIDATION.md).

A further finding from that analysis: most remaining false positives come from the fixed 2% tolerance against
Multipli's OSM, whose queued price lags the market by up to 2 hours (e.g. an honest −1%/h decline is frozen). A
graded overvaluation response is recorded as future work; it was deliberately not tuned against the test suite.
