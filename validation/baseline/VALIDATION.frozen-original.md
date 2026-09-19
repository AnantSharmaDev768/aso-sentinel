# Validation report

> **Generated file — do not edit by hand.** Every number below comes from `validation/validation-results.json`, produced by
> `cd demo && npm run validate` on 2026-09-19T15:55:41.306Z (commit `3591d5e`, uncommitted changes present, forge Version: 1.8.3).
> Runtime 73 s. Network: local anvil (chain id 31337) — synthetic prices, anvil test keys.

## 1. Executive summary

- **N = 38 test cases**: 29 risk (attack or oracle failure), 8 healthy, 1 degraded.
- **Risk cases:** 27 true positives, 2 false negatives → recall **93.1%**.
- **Healthy cases:** 4 true negatives, 4 false positives → false-positive rate **50.0%**; precision **87.1%**. Borrowing was restricted at 17 of 34 healthy-case pokes (11 fully blocked, the rest limited to WATCH headroom).
- **Degraded cases:** 1 of 1 matched the documented degraded policy.
- **Safety invariants:** 835 checks over 167 pokes, **0 violations**. State transitions observed: 46, **0 violations**.
- **Detection latency** (risk cases detected by the Sentinel, excluding in-transaction verifier rejections): min 0 s, median 0 s, max 24.0 h over 20 cases. 7 invalid-data cases were rejected by the verifier in the submitting transaction.

**What these numbers are — and are not.** They describe behaviour on this hand-built suite of synthetic scenarios, run against the
real contracts. They are not estimates of real-world detection rates: the cases, prices and thresholds were chosen by the team, the
sources are test keys, and market depth is an assumption. Several cases were included *because* we expected the design to fail them.

## 2. Methodology

Each case starts from the same healthy snapshot (Sentinel FRESH, Alice 50,000 rwaUSD debt on both markets), performs real transactions
on a local anvil chain, and calls the permissionless `poke()` after every price event. After each poke the harness records the state,
flags and debt ceiling, and probes with `eth_call` (nothing mined) whether a 1,000 rwaUSD **borrow** and a 1,000 rwaUSD **repayment**
would succeed on the protected Vat, and whether the same borrow would succeed on the unprotected **baseline** Vat.

Ground truth is fixed per case before running:

| Truth | Meaning | Correct outcome |
|---|---|---|
| risk | an attack or oracle failure is present | the Sentinel reaches the required protection (**limited** = WATCH or stricter, **blocked** = ceiling 0) and does not lapse back to unrestricted while the risk persists; for invalid data, the verifier rejects it |
| healthy | honest market, honest sources | never restricted (WATCH counts as a restriction) |
| degraded | sources partly unavailable | the documented degraded policy (3/5 sources → WATCH) |

- **TP / FN** — risk case protected / not protected (or protection lapsed while the risk persisted).
- **TN / FP** — healthy case never restricted / restricted at any point.
- **Precision** = TP / (TP + FP) · **Recall** = TP / (TP + FN) · **False-positive rate** = FP / (FP + TN).
- **Detection latency** = chain time from the case's ground-truth onset to the first poke meeting the required protection. Pokes follow every
  price event (outages: every 10 minutes), so latency excludes keeper delay; the resolution is one poke.
- **Invariants checked at every poke:** the poke never changes the Vat's collateral price; restricted ⇒ ceiling 0; the ceiling equals
  `policyLine(state)` read from the contract; a repayment would succeed; a borrow would revert in restricted states.
- **Transition rule checked at every change:** DISPUTED/PROTECTIVE never go directly to FRESH/WATCH; RECOVERING opens only after a newer
  accepted round and the recovery delay.

## 3. Configuration under test (read from the deployed contracts)

| Parameter | Value |
|---|---|
| Quorum | 3 of 5 sources, agreement within 1% |
| Attestation max age | 60 min |
| TWAP window / min coverage | 6.0 h / 50% |
| TWAP deviation watch / protect | 3% / 15% |
| Velocity watch / protect | 5%/h / 20%/h |
| Weighted-source divergence | 0.5% |
| Vat vs effective price tolerance | 2% |
| Recovery delay | 60 min |
| Gap / WATCH share / max line | 200,000 / 25% / 1,000,000 rwaUSD |
| Epoch / growth cap | 24.0 h / 100,000 rwaUSD |
| Market depth assumption (default) | $250,000 per 1% (governance assumption, not measured) |
| Loss share / ELEVATED / HIGH ratio | 50% / 3× / 1× |
| Liquidation ratio (mat) | 140% |

## 4. Scenario inventory and results

### Healthy market

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Healthy baseline | healthy | 5/5 · 0 | Stays FRESH, normal borrowing | FRESH (FRESH) | would succeed | TN | — | ✅ |
| H2 | Honest gradual movement (+0.5%/h) | healthy | 5/5 · 0 | Stays FRESH | FRESH (FRESH) | would succeed | TN | — | ✅ |
| H3 | Legitimate strong rally (+2%/h) | healthy | 5/5 · 0 | Ideally FRESH; may trip the 3% TWAP-watch band | PROTECTIVE (FRESH → WATCH → PROTECTIVE) | would revert | FP | — | ❌ |
| H4 | Temporary volatility (+6% spike, then back) | healthy | 5/5 · 0 | Brief WATCH at most; must not freeze permanently | FRESH (WATCH → PROTECTIVE → RECOVERING → FRESH) | would succeed | FP | — | ❌ |
| H5 | Extreme but legitimate move (+25% in 1 h) | healthy | 5/5 · 0 | Policy restricts anyway (velocity ≥ 20%/h): a known false positive | PROTECTIVE (PROTECTIVE) | would revert | FP | — | ❌ |
| H6 | Legitimate decline (−10% in 1 h) | healthy | 5/5 · 0 | Likely PROTECTIVE while the OSM lags (Vat above effective price) | WATCH (PROTECTIVE → RECOVERING → WATCH) | would succeed | FP | — | ❌ |

### Market manipulation

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Thin-market pump, all sources honestly report it | risk | 5/5 · 5 | PROTECTIVE (TWAP, velocity, cost gate) | PROTECTIVE (WATCH → PROTECTIVE) | would revert | TP | 0 s | ✅ |
| A2 | Sudden large movement (+30% in one round) | risk | 5/5 · 5 | PROTECTIVE (velocity ≥ 20%/h, TWAP ≥ 15%) | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |
| A3 | Sustained manipulation, thin-market assumption | risk | 5/5 · 5 | PROTECTIVE, then at best WATCH (cost gate) once the TWAP catches up | WATCH (PROTECTIVE → RECOVERING → WATCH) | would succeed | TP | 1 s | ✅ |
| A4 | Sustained manipulation, deep-market assumption | risk | 5/5 · 5 | Known limit: may return to FRESH after the TWAP window | FRESH (PROTECTIVE → RECOVERING → FRESH) | would succeed | FN | 0 s | ❌ |
| A5 | Creeping manipulation (+10%/h for 6 h) | risk | 5/5 · 5 | At least WATCH (velocity ≥ 5%/h), PROTECTIVE once far from TWAP | PROTECTIVE (WATCH → PROTECTIVE) | would revert | TP | 0 s | ✅ |
| A6 | Sub-threshold manipulation (+2.5%) | risk | 5/5 · 5 | Not detected: below the 3% / 5%/h thresholds (detection floor) | FRESH (FRESH) | would succeed | FN | — | ❌ |

### Coordinated sources

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 1 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 1 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| M2 | 2 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 2 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 1 s | ✅ |
| M3 | 3 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 3 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| M4 | 4 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 4 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| V3 | 3 of 5 sources collude, only their signatures relayed | risk | 5/5 · 3 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |
| V4 | 4 of 5 sources collude, only their signatures relayed | risk | 5/5 · 4 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 1 s | ✅ |
| V5 | 5 of 5 sources collude, only their signatures relayed | risk | 5/5 · 5 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |

### Oracle failure

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Stale upstream price while the market falls | risk | 5/5 · 0 | PROTECTIVE (Vat price above effective price) | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |
| F2 | Upstream feed frozen for 25 hours | risk | 5/5 · 0 | PROTECTIVE once the adapter reports stale (24 h) | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 24.0 h | ✅ |
| F3 | Conflicting sources (1500 / 2500 / 2510) | risk | 3/5 · 1 | DISPUTED | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |

### Invalid data

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | Forged price under a real signature | risk | 5/5 · 1 | Verifier reverts InvalidSignature | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I2 | Unauthorised signer | risk | 5/5 · 1 | Verifier reverts UnauthorizedSigner | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I3 | Replay of an accepted round | risk | 5/5 · 0 | Verifier reverts NonceNotIncreasing | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I4 | Stale nonce (fresh signatures, old round number) | risk | 5/5 · 0 | Verifier reverts NonceNotIncreasing | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I5 | One source counted twice | risk | 2/5 · 0 | Verifier reverts SignersNotStrictlyAscending | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I6 | Insufficient quorum (2 signatures) | risk | 2/5 · 0 | Verifier reverts QuorumNotMet | FRESH (FRESH) | would succeed | TP | same tx | ✅ |
| I7 | Expired attestation | risk | 5/5 · 0 | Verifier reverts Expired | FRESH (FRESH) | would succeed | TP | same tx | ✅ |

### Source availability

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S5 | 5 of 5 sources online | healthy | 5/5 · 0 | FRESH | FRESH (FRESH) | would succeed | TN | — | ✅ |
| S4 | 4 of 5 sources online | healthy | 4/5 · 0 | FRESH (redundancy remains) | FRESH (FRESH) | would succeed | TN | — | ✅ |
| S3 | 3 of 5 sources online (minimum quorum) | degraded | 3/5 · 0 | WATCH: borrowing limited (no redundancy left) | WATCH (WATCH) | would succeed | MATCH | 0 s | ✅ |
| S2 | 2 of 5 sources online (quorum impossible) | risk | 2/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min | ✅ |
| S1 | 1 of 5 sources online (quorum impossible) | risk | 1/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min | ✅ |
| S0 | 0 of 5 sources online (quorum impossible) | risk | 0/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 50 min | ✅ |

### Recovery

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Recovery after an attack | risk | 5/5 · 1 | DISPUTED → RECOVERING → FRESH, never earlier than the delay | FRESH (DISPUTED → RECOVERING → FRESH) | would succeed | TP | 0 s | ✅ |
| R2 | Relapse during recovery | risk | 5/5 · 5 | Never reopens between the two pumps | PROTECTIVE (PROTECTIVE → RECOVERING → WATCH → FRESH) | would revert | TP | 0 s | ✅ |
| R3 | Oracle outage, then recovery | risk | 0/5 · 0 | PROTECTIVE → RECOVERING → FRESH after new round + delay | FRESH (FRESH → PROTECTIVE → RECOVERING) | would succeed | TP | 50 min | ✅ |

## 5. Source availability

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S5 | 5 of 5 sources online | healthy | 5/5 · 0 | FRESH | FRESH (FRESH) | would succeed | TN | — | ✅ |
| S4 | 4 of 5 sources online | healthy | 4/5 · 0 | FRESH (redundancy remains) | FRESH (FRESH) | would succeed | TN | — | ✅ |
| S3 | 3 of 5 sources online (minimum quorum) | degraded | 3/5 · 0 | WATCH: borrowing limited (no redundancy left) | WATCH (WATCH) | would succeed | MATCH | 0 s | ✅ |
| S2 | 2 of 5 sources online (quorum impossible) | risk | 2/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min | ✅ |
| S1 | 1 of 5 sources online (quorum impossible) | risk | 1/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min | ✅ |
| S0 | 0 of 5 sources online (quorum impossible) | risk | 0/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 50 min | ✅ |

With fewer than 3 sources no round can be accepted; the last accepted round stays valid until it is 60 min old,
so exposure during that window is bounded by the debt ceiling set at the last healthy poke. At exactly the quorum (3/5) the Sentinel
limits borrowing (WATCH) because one more outage would stop new rounds; this requires the relayer to post the per-source record
(`recordSources`), otherwise availability is not visible on-chain.

## 6. Coordinated source manipulation

| ID | Case | Truth | Sources online / manipulated | Expected (policy) | Actual final state | Borrow probe (final) | Outcome | Latency | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 1 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 1 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| M2 | 2 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 2 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 1 s | ✅ |
| M3 | 3 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 3 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| M4 | 4 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 4 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s | ✅ |
| V3 | 3 of 5 sources collude, only their signatures relayed | risk | 5/5 · 3 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |
| V4 | 4 of 5 sources collude, only their signatures relayed | risk | 5/5 · 4 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 1 s | ✅ |
| V5 | 5 of 5 sources collude, only their signatures relayed | risk | 5/5 · 5 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s | ✅ |

A minority of lying sources cannot produce an accepted price if the honest signatures are relayed (spread > 1% → DISPUTED).
A colluding majority — or a malicious relayer that submits only the colluders — produces a **cryptographically valid** round; only the
economic layer (TWAP deviation, velocity, cost gate) can object.

## 7. False positives and false negatives

**False positives (4 of 8 healthy cases).** Across all healthy cases borrowing was restricted at 17 of 34 pokes (11 fully blocked, the rest limited to WATCH headroom).

| Case | Restricted pokes | Worst state | Signals that restricted | Back to FRESH by the end? |
|---|---|---|---|---|
| H3 — Legitimate strong rally (+2%/h) | 5 / 6 | PROTECTIVE | TWAP_DEVIATION_WATCH, VAT_ABOVE_EFFECTIVE | no |
| H4 — Temporary volatility (+6% spike, then back) | 4 / 5 | RECOVERING | TWAP_DEVIATION_WATCH, VELOCITY_WATCH, VAT_ABOVE_EFFECTIVE | yes |
| H5 — Extreme but legitimate move (+25% in 1 h) | 4 / 4 | PROTECTIVE | TWAP_DEVIATION_PROTECT, VELOCITY_PROTECT, VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH | no |
| H6 — Legitimate decline (−10% in 1 h) | 4 / 4 | RECOVERING | VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH, VELOCITY_WATCH | no |

**Why `VAT_ABOVE_EFFECTIVE` fires in honest markets.** The Vat lends at Multipli's OSM price, which lags the market by 1 h, while the effective price is min(attested, 6 h TWAP). In a steady rally the lagged price still exceeds the slower TWAP by more than 2%; after a drop the lagged price exceeds the new market price, so the Vat genuinely overvalues collateral for up to an hour. The same conservatism keeps A4 protected during its first hours: relaxing it would trade false positives for later detection. The case labels were fixed before the first run and were not changed after seeing these results.

**False negatives (2):**

- **A4 — Sustained manipulation, deep-market assumption.** Final state FRESH; 1 poke(s) after onset · lapsed to FRESH while the risk persisted. Known limit: may return to FRESH after the TWAP window.
- **A6 — Sub-threshold manipulation (+2.5%).** Final state FRESH; required protection never reached. Not detected: below the 3% / 5%/h thresholds (detection floor).

## 8. Detection latency

| Case | Onset → protection | Note |
|---|---|---|
| A1 — Thin-market pump, all sources honestly report it | 0 s | 1 poke(s) after onset |
| A2 — Sudden large movement (+30% in one round) | 0 s | 1 poke(s) after onset |
| A3 — Sustained manipulation, thin-market assumption | 1 s | 1 poke(s) after onset |
| A4 — Sustained manipulation, deep-market assumption | 0 s | 1 poke(s) after onset · lapsed to FRESH while the risk persisted |
| A5 — Creeping manipulation (+10%/h for 6 h) | 0 s | 1 poke(s) after onset |
| A6 — Sub-threshold manipulation (+2.5%) | — | required protection never reached |
| M1 — 1 of 5 sources manipulated (all signatures relayed) | 0 s | 1 poke(s) after onset |
| M2 — 2 of 5 sources manipulated (all signatures relayed) | 1 s | 1 poke(s) after onset |
| M3 — 3 of 5 sources manipulated (all signatures relayed) | 0 s | 1 poke(s) after onset |
| M4 — 4 of 5 sources manipulated (all signatures relayed) | 0 s | 1 poke(s) after onset |
| V3 — 3 of 5 sources collude, only their signatures relayed | 0 s | 1 poke(s) after onset |
| V4 — 4 of 5 sources collude, only their signatures relayed | 1 s | 1 poke(s) after onset |
| V5 — 5 of 5 sources collude, only their signatures relayed | 0 s | 1 poke(s) after onset |
| F1 — Stale upstream price while the market falls | 0 s | 1 poke(s) after onset |
| F2 — Upstream feed frozen for 25 hours | 24.0 h | 23 poke(s) after onset |
| F3 — Conflicting sources (1500 / 2500 / 2510) | 0 s | 1 poke(s) after onset |
| I1 — Forged price under a real signature | same transaction | rejected in the submitting transaction |
| I2 — Unauthorised signer | same transaction | rejected in the submitting transaction |
| I3 — Replay of an accepted round | same transaction | rejected in the submitting transaction |
| I4 — Stale nonce (fresh signatures, old round number) | same transaction | rejected in the submitting transaction |
| I5 — One source counted twice | same transaction | rejected in the submitting transaction |
| I6 — Insufficient quorum (2 signatures) | same transaction | rejected in the submitting transaction |
| I7 — Expired attestation | same transaction | rejected in the submitting transaction |
| S3 — 3 of 5 sources online (minimum quorum) | 0 s |  |
| S2 — 2 of 5 sources online (quorum impossible) | 61 min | 6 poke(s) after onset |
| S1 — 1 of 5 sources online (quorum impossible) | 61 min | 6 poke(s) after onset |
| S0 — 0 of 5 sources online (quorum impossible) | 50 min | 6 poke(s) after onset |
| R1 — Recovery after an attack | 0 s | 1 poke(s) after onset |
| R2 — Relapse during recovery | 0 s | 1 poke(s) after onset |
| R3 — Oracle outage, then recovery | 50 min | 6 poke(s) after onset |

## 9. State-transition correctness

46 state transitions were observed across all cases; 0 violated the transition rules.

## 10. Manipulation-cost methodology (as implemented in `src/risk/CostModel.sol`)

```
d               price inflation the attacker aims for (fraction)
D               governance depth ASSUMPTION: USD that moves the price by 1%   (default $250,000)
H               new debt the attacker could take right now = the Sentinel's FRESH headroom
mat             liquidation ratio (140%)
lossShare       assumed share of (capital × move) lost unwinding the position (50%)

capital(d)      = D × (d in %)
cost(d)         = capital(d) × d × lossShare
extractable(d)  = H × max(0, 1 − mat / (1 + d))
ratio           = cost / extractable, evaluated at d0 = mat − 1 and d0 + 5, 15, 30, 60 points; the lowest ratio decides
LOW ≥ 3× · ELEVATED 1–3× (→ WATCH) · HIGH < 1× (→ PROTECTIVE) · missing/stale depth → INSUFFICIENT DATA (→ WATCH)
```

This is a simplified economic proxy. It does not model order books, multiple venues, flash loans, MEV, cross-venue arbitrage,
liquidation cascades or non-linear slippage. A "LOW" verdict means *under the stated assumptions, the modelled attack cost exceeds the
modelled extractable value* — not that an attack is impossible.

## 11. Sensitivity analysis (every point from `ASORiskEngine.quote()` on the deployed contract)

| Depth $/1% | Headroom H (rwaUSD) | d | Capital | Cost | Extractable | Cost / extractable |
|---|---|---|---|---|---|---|
| $1,000 | 50,000 | +5% | $5.0k | $125 | $0 | ∞ (nothing extractable) |
| $1,000 | 50,000 | +15% | $15.0k | $1.1k | $0 | ∞ (nothing extractable) |
| $1,000 | 50,000 | +30% | $30.0k | $4.5k | $0 | ∞ (nothing extractable) |
| $1,000 | 50,000 | +60% | $60.0k | $18.0k | $6.3k | 2.88× |
| $1,000 | 50,000 | +70% | $70.0k | $24.5k | $8.8k | 2.78× |
| $1,000 | 50,000 | +100% | $100.0k | $50.0k | $15.0k | 3.33× |
| $1,000 | 950,000 | +5% | $5.0k | $125 | $0 | ∞ (nothing extractable) |
| $1,000 | 950,000 | +15% | $15.0k | $1.1k | $0 | ∞ (nothing extractable) |
| $1,000 | 950,000 | +30% | $30.0k | $4.5k | $0 | ∞ (nothing extractable) |
| $1,000 | 950,000 | +60% | $60.0k | $18.0k | $118.8k | 0.15× |
| $1,000 | 950,000 | +70% | $70.0k | $24.5k | $167.6k | 0.15× |
| $1,000 | 950,000 | +100% | $100.0k | $50.0k | $285.0k | 0.18× |
| $25,000 | 50,000 | +5% | $125.0k | $3.1k | $0 | ∞ (nothing extractable) |
| $25,000 | 50,000 | +15% | $375.0k | $28.1k | $0 | ∞ (nothing extractable) |
| $25,000 | 50,000 | +30% | $750.0k | $112.5k | $0 | ∞ (nothing extractable) |
| $25,000 | 50,000 | +60% | $1.50M | $450.0k | $6.3k | 72.00× |
| $25,000 | 50,000 | +70% | $1.75M | $612.5k | $8.8k | 69.42× |
| $25,000 | 50,000 | +100% | $2.50M | $1.25M | $15.0k | 83.33× |
| $25,000 | 950,000 | +5% | $125.0k | $3.1k | $0 | ∞ (nothing extractable) |
| $25,000 | 950,000 | +15% | $375.0k | $28.1k | $0 | ∞ (nothing extractable) |
| $25,000 | 950,000 | +30% | $750.0k | $112.5k | $0 | ∞ (nothing extractable) |
| $25,000 | 950,000 | +60% | $1.50M | $450.0k | $118.8k | 3.79× |
| $25,000 | 950,000 | +70% | $1.75M | $612.5k | $167.6k | 3.65× |
| $25,000 | 950,000 | +100% | $2.50M | $1.25M | $285.0k | 4.39× |
| $250,000 | 50,000 | +5% | $1.25M | $31.3k | $0 | ∞ (nothing extractable) |
| $250,000 | 50,000 | +15% | $3.75M | $281.3k | $0 | ∞ (nothing extractable) |
| $250,000 | 50,000 | +30% | $7.50M | $1.13M | $0 | ∞ (nothing extractable) |
| $250,000 | 50,000 | +60% | $15.00M | $4.50M | $6.3k | 720.00× |
| $250,000 | 50,000 | +70% | $17.50M | $6.13M | $8.8k | 694.17× |
| $250,000 | 50,000 | +100% | $25.00M | $12.50M | $15.0k | 833.33× |
| $250,000 | 950,000 | +5% | $1.25M | $31.3k | $0 | ∞ (nothing extractable) |
| $250,000 | 950,000 | +15% | $3.75M | $281.3k | $0 | ∞ (nothing extractable) |
| $250,000 | 950,000 | +30% | $7.50M | $1.13M | $0 | ∞ (nothing extractable) |
| $250,000 | 950,000 | +60% | $15.00M | $4.50M | $118.8k | 37.89× |
| $250,000 | 950,000 | +70% | $17.50M | $6.13M | $167.6k | 36.53× |
| $250,000 | 950,000 | +100% | $25.00M | $12.50M | $285.0k | 43.86× |

**Gate verdicts** (lowest ratio over the evaluated attack sizes):

| Depth $/1% | Headroom H | Verdict | Most attractive d | Ratio |
|---|---|---|---|---|
| $1,000 | 50,000 | ELEVATED | +70% | 2.78× |
| $1,000 | 950,000 | HIGH CONCERN | +70% | 0.15× |
| $25,000 | 50,000 | LOW CONCERN | +70% | 69.42× |
| $25,000 | 950,000 | LOW CONCERN | +70% | 3.65× |
| $250,000 | 50,000 | LOW CONCERN | +70% | 694.17× |
| $250,000 | 950,000 | LOW CONCERN | +70% | 36.53× |

The headroom column contrasts the Sentinel's bounded FRESH headroom (50,000) with the unprotected
baseline's remaining capacity (950,000) under the same depth assumption.

## 12. Historical validation

See `shared/historical.mjs` and the dashboard's Validation page. Each incident separates **documented historical fact** (with sources),
**our retrospective signal mapping**, the **reproduced test** cases (synthetic patterns — no historical data is replayed), and what is
**not modeled**. No claim is made that Origin would have prevented any historical incident.

## 13. Limitations

- Synthetic, team-designed scenarios; sources are local test keys; not a statistical sample of real markets.
- Market depth and source weights are governance assumptions; the cost gate is only as good as they are.
- A manipulation sustained longer than the TWAP window becomes the TWAP (see A4); the epoch cap and WATCH headroom bound, but do not prevent, loss.
- Latency excludes keeper delay (the harness pokes after every event).
- Availability is visible on-chain only if the relayer posts per-source records.
- Collateral withdrawal at a stale-high price and liquidations are outside Origin's scope.
- Prototype: not audited, not integrated with Multipli.

## 14. Reproduce

```bash
forge build
cd demo && npm ci && npm run validate
```
