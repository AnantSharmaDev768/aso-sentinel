# Validation report

> **Generated file — do not edit by hand.** Every number comes from the result files in `validation/`, produced by
> `cd demo && npm run validate` against the real contracts on a local anvil chain (synthetic prices, anvil test keys).
>
> | Result file | Rules | Generated | Commit |
> |---|---|---|---|
> | `validation/baseline/main.json` | baseline | 2026-09-19T16:14:11.517Z | `3591d5e` + uncommitted changes |
> | `validation/baseline/holdout.json` | baseline | 2026-09-19T16:14:43.293Z | `3591d5e` + uncommitted changes |
> | `validation/candidate-graded/main.json` | candidate-graded | 2026-09-19T16:21:41.115Z | `3591d5e` + uncommitted changes |
> | `validation/candidate-graded/holdout.json` | candidate-graded | 2026-09-19T16:22:13.441Z | `3591d5e` + uncommitted changes |
> | `validation/final/main.json` | final | 2026-09-19T17:15:53.053Z | `3591d5e` + uncommitted changes |
> | `validation/final/holdout.json` | final | 2026-09-19T17:16:26.415Z | `3591d5e` + uncommitted changes |

## 1. Summary — baseline vs final

| Result set | N (risk/healthy/degraded) | TP | FN | TN | FP | Recall | Precision | FP rate | Healthy pokes restricted |
|---|---|---|---|---|---|---|---|---|---|
| **Baseline rules — main suite** | 38 (29/8/1) | 27 | 2 | 4 | 4 | 93.1% | 87.1% | 50.0% | 17/34 (11 blocked) |
| Baseline rules — holdout suite | 19 (11/7/1) | 10 | 1 | 2 | 5 | 90.9% | 66.7% | 71.4% | 19/34 (12 blocked) |
| Candidate GRADED rule (rejected) — main | 38 (29/8/1) | 27 | 2 | 4 | 4 | 93.1% | 87.1% | 50.0% | 17/34 (9 blocked) |
| Candidate GRADED rule (rejected) — holdout | 19 (11/7/1) | 10 | 1 | 2 | 5 | 90.9% | 66.7% | 71.4% | 18/34 (10 blocked) |
| **Final rules — main suite** | 38 (29/8/1) | 27 | 2 | 4 | 4 | 93.1% | 87.1% | 50.0% | 17/34 (11 blocked) |
| Final rules — holdout suite | 19 (11/7/1) | 10 | 1 | 2 | 5 | 90.9% | 66.7% | 71.4% | 18/34 (12 blocked) |

The **baseline** is the original rule set and is never overwritten (the first baseline run is also archived unchanged in
`validation/baseline/main.frozen-original.json`). One alternative rule was evaluated and **rejected** (§2), so the **final**
rules are the baseline rules; the final run re-executes them on the finished contract code to show the added code changed no outcome.
Safety invariants and transition rules were checked at every poke in every run:
baseline/main: 835 invariant checks, 0 violations; 46 transitions, 0 violations · baseline/holdout: 335 invariant checks, 0 violations; 26 transitions, 0 violations · candidate-graded/main: 835 invariant checks, 0 violations; 47 transitions, 0 violations · candidate-graded/holdout: 335 invariant checks, 0 violations; 26 transitions, 0 violations · final/main: 835 invariant checks, 0 violations; 46 transitions, 0 violations · final/holdout: 335 invariant checks, 0 violations; 26 transitions, 0 violations.

**What these numbers are — and are not.** They describe behaviour on hand-built synthetic scenarios run against the real
contracts. They are not real-world detection rates: the scenarios, prices and thresholds were chosen by the team, sources are
test keys and market depth is an assumption. Several cases were included because we expected the design to miss them.

## 2. The one candidate rule change, and why it was rejected

**The candidate change (written before any candidate result existed; at that time it was intended to become the default).** One rule: how the Vat's lending price is checked (`OriginSentinel.vatCheck`).

| | Baseline rule (CONSERVATIVE) | Candidate rule (GRADED) |
|---|---|---|
| Freeze (PROTECTIVE) | Vat price > **min(attested, 6 h TWAP)** × 1.02 | Vat price > **attested price** × 1.02 |
| Limit (WATCH) | — | Vat price > 6 h TWAP × (1 + TWAP watch band, 3%) |

**Why it was proposed — reasoning independent of the test set.** The 2% tolerance was introduced (v1 `ASOSentinel`) to compare two
measurements of the *same current price*: the price the Vat lends at and the price the sources sign now. The baseline rule
compares the Vat with min(attested, TWAP), which in practice is the 6 h average whenever the market is rising. That makes it a
second, undocumented TWAP rule — "freeze at 2% above the average" — which contradicts the documented policy that distance from
the TWAP is graded (3% → WATCH, 15% → PROTECTIVE). The candidate removes that contradiction: overvaluation against the
current market still freezes; lending above the recent average is graded with the same band as every other TWAP signal.
No new threshold was introduced — both comparisons reuse existing parameters (2% tolerance, 3% watch band).

**Security property the candidate preserves.** The Vat must not lend above the current signed market price (the stale-OSM /
frozen-feed case: F1, F2, X16, X17, D in the demo). That freeze is unchanged in both modes (`test_VatCheck_BothModes_StaleOsmAboveMarketFreezes`).

**What it risks weakening.** Once Multipli's OSM passes a manipulated price through, the Vat equals the attested price, so
the candidate rule can no longer freeze on "Vat above average" alone — it limits borrowing (WATCH) instead. During a sustained
manipulation the freeze must then come from the TWAP-deviation (≥ 15%) and velocity signals. Expected effect: shorter
PROTECTIVE periods in long pumps (A3, A4, X11). This is measured below, not assumed.

**How it was selected.** From the documented design intent above, after the baseline run showed that the rule caused most
restrictions in honest markets. It was not selected by searching over thresholds or rules against the test cases, and no
threshold value was changed. The holdout suite was written before the change and was not used to choose it; it is reported
for both rule sets so the effect on unseen scenarios is visible.

**How to reproduce.** `npm run validate -- --rules=baseline` (original rules, set explicitly) and
`npm run validate -- --rules=candidate-graded` (the alternative) each run on a fresh chain.

---

**Outcome and decision (written after the runs; the numbers are in §1).**

- The GRADED candidate changed **no** TP/FN/TN/FP count on either suite.
- It reduced fully-frozen healthy pokes by 2 on each suite (honest rallies H3 and X2 became *limited* instead of *frozen*).
- It shortened the freeze in every sustained manipulation (A3, A4, X11) by 2 pokes, replacing it with WATCH — exactly the
  predicted risk, in the attack class that is already Origin's weakest.
- Per-case analysis of the remaining false positives (X3, X4, X6, H4, H6) showed that their dominant cause is not the TWAP
  comparison but the fixed 2% tolerance against Multipli's OSM, whose queued price lags the market by up to 2 hours. Both
  rule variants freeze on it.

**Decision: the candidate is rejected as the default.** Under the project's stated priority (bounded loss, fail closed), trading
two frozen hours during a sustained attack for two frozen hours during an honest rally is not an improvement. The final rules are
therefore the baseline rules (`vatCheck = CONSERVATIVE`, the contract default). The inconsistency that motivated the candidate
is fixed by documentation instead: the policy now states the rule explicitly — *the Vat must not lend more than 2% above the
conservative valuation min(market, 6 h average)* — rather than leaving it implicit. GRADED stays selectable only so this
comparison remains reproducible; it is not recommended.

## 3. Methodology

Every case starts from the same healthy snapshot (Sentinel FRESH, Alice 50,000 rwaUSD debt on both markets), performs real
transactions, and calls the permissionless `poke()` after every price event. After each poke the harness records state, flags
and debt ceiling and probes with `eth_call` (nothing mined) whether a 1,000 rwaUSD borrow and repayment would succeed on the
protected Vat, and whether the borrow would succeed on the unprotected baseline Vat.

| Truth | Meaning | Correct outcome |
|---|---|---|
| risk | attack or oracle failure present | required protection reached (**limited** = WATCH or stricter, **blocked** = ceiling 0) and not lapsed back to unrestricted while the risk persists; invalid data rejected by the verifier |
| healthy | honest market and sources | never restricted (WATCH counts as a restriction) |
| degraded | sources partly unavailable | documented degraded policy (3/5 → WATCH) |

TP/FN on risk cases, TN/FP on healthy cases. Precision = TP/(TP+FP), recall = TP/(TP+FN), FP rate = FP/(FP+TN). Latency is
chain time from the case's ground-truth onset to the first poke meeting the required protection (pokes follow every price
event, so keeper delay is excluded). Invariants at every poke: the poke never changes the Vat's collateral price; restricted ⇒
ceiling 0; ceiling = `policyLine(state)`; a repayment would succeed; a borrow would revert when restricted. Transition rule:
DISPUTED/PROTECTIVE never go straight to FRESH/WATCH; RECOVERING opens only after a newer accepted round and the delay.

The **holdout suite** (`HOLDOUT` in `shared/validation.mjs`) was written before the rule change, uses magnitudes and shapes that
do not appear in the main suite, and was not used to choose the change — only to measure it.

## 4. Configuration under test (read from the deployed contracts)

| Parameter | Value |
|---|---|
| Quorum | 3 of 5, agreement within 1% |
| Attestation max age | 60 min |
| TWAP window / minimum coverage | 6.0 h / 50% |
| TWAP watch / protect | 3% / 15% |
| Velocity watch / protect | 5%/h / 20%/h |
| Vat price tolerance | 2% |
| Recovery delay | 60 min |
| Gap / WATCH share / max line | 200,000 / 25% / 1,000,000 rwaUSD |
| Epoch / growth cap | 24.0 h / 100,000 rwaUSD |
| Depth assumption (default) | $250,000 per 1% — governance assumption, not measured |
| Loss share / ELEVATED / HIGH | 50% / 3× / 1× |
| Liquidation ratio (mat) | 140% |

## 5. Main suite — final rules

### Healthy market

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Healthy baseline | healthy | 5/5 · 0 | Stays FRESH, normal borrowing | FRESH (FRESH) | would succeed | TN | — |
| H2 | Honest gradual movement (+0.5%/h) | healthy | 5/5 · 0 | Stays FRESH | FRESH (FRESH) | would succeed | TN | — |
| H3 | Legitimate strong rally (+2%/h) | healthy | 5/5 · 0 | Ideally FRESH; may trip the 3% TWAP-watch band | PROTECTIVE (FRESH → WATCH → PROTECTIVE) | would revert | FP | — |
| H4 | Temporary volatility (+6% spike, then back) | healthy | 5/5 · 0 | Brief WATCH at most; must not freeze permanently | FRESH (WATCH → PROTECTIVE → RECOVERING → FRESH) | would succeed | FP | — |
| H5 | Extreme but legitimate move (+25% in 1 h) | healthy | 5/5 · 0 | Policy restricts anyway (velocity ≥ 20%/h): a known false positive | PROTECTIVE (PROTECTIVE) | would revert | FP | — |
| H6 | Legitimate decline (−10% in 1 h) | healthy | 5/5 · 0 | Likely PROTECTIVE while the OSM lags (Vat above effective price) | WATCH (PROTECTIVE → RECOVERING → WATCH) | would succeed | FP | — |

### Market manipulation

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Thin-market pump, all sources honestly report it | risk | 5/5 · 5 | PROTECTIVE (TWAP, velocity, cost gate) | PROTECTIVE (WATCH → PROTECTIVE) | would revert | TP | 0 s |
| A2 | Sudden large movement (+30% in one round) | risk | 5/5 · 5 | PROTECTIVE (velocity ≥ 20%/h, TWAP ≥ 15%) | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| A3 | Sustained manipulation, thin-market assumption | risk | 5/5 · 5 | PROTECTIVE, then at best WATCH (cost gate) once the TWAP catches up | WATCH (PROTECTIVE → RECOVERING → WATCH) | would succeed | TP | 1 s |
| A4 | Sustained manipulation, deep-market assumption | risk | 5/5 · 5 | Known limit: may return to FRESH after the TWAP window | FRESH (PROTECTIVE → RECOVERING → FRESH) | would succeed | FN | 0 s |
| A5 | Creeping manipulation (+10%/h for 6 h) | risk | 5/5 · 5 | At least WATCH (velocity ≥ 5%/h), PROTECTIVE once far from TWAP | PROTECTIVE (WATCH → PROTECTIVE) | would revert | TP | 1 s |
| A6 | Sub-threshold manipulation (+2.5%) | risk | 5/5 · 5 | Not detected: below the 3% / 5%/h thresholds (detection floor) | FRESH (FRESH) | would succeed | FN | — |

### Coordinated sources

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 1 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 1 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 1 s |
| M2 | 2 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 2 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s |
| M3 | 3 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 3 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s |
| M4 | 4 of 5 sources manipulated (all signatures relayed) | risk | 5/5 · 4 | DISPUTED (spread > 1%) | DISPUTED (DISPUTED) | would revert | TP | 0 s |
| V3 | 3 of 5 sources collude, only their signatures relayed | risk | 5/5 · 3 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| V4 | 4 of 5 sources collude, only their signatures relayed | risk | 5/5 · 4 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| V5 | 5 of 5 sources collude, only their signatures relayed | risk | 5/5 · 5 | Verifier accepts; risk engine → PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |

### Oracle failure

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Stale upstream price while the market falls | risk | 5/5 · 0 | PROTECTIVE (Vat price above effective price) | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| F2 | Upstream feed frozen for 25 hours | risk | 5/5 · 0 | PROTECTIVE once the adapter reports stale (24 h) | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 24.0 h |
| F3 | Conflicting sources (1500 / 2500 / 2510) | risk | 3/5 · 1 | DISPUTED | DISPUTED (DISPUTED) | would revert | TP | 1 s |

### Invalid data

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | Forged price under a real signature | risk | 5/5 · 1 | Verifier reverts InvalidSignature | FRESH (FRESH) | would succeed | TP | same tx |
| I2 | Unauthorised signer | risk | 5/5 · 1 | Verifier reverts UnauthorizedSigner | FRESH (FRESH) | would succeed | TP | same tx |
| I3 | Replay of an accepted round | risk | 5/5 · 0 | Verifier reverts NonceNotIncreasing | FRESH (FRESH) | would succeed | TP | same tx |
| I4 | Stale nonce (fresh signatures, old round number) | risk | 5/5 · 0 | Verifier reverts NonceNotIncreasing | FRESH (FRESH) | would succeed | TP | same tx |
| I5 | One source counted twice | risk | 2/5 · 0 | Verifier reverts SignersNotStrictlyAscending | FRESH (FRESH) | would succeed | TP | same tx |
| I6 | Insufficient quorum (2 signatures) | risk | 2/5 · 0 | Verifier reverts QuorumNotMet | FRESH (FRESH) | would succeed | TP | same tx |
| I7 | Expired attestation | risk | 5/5 · 0 | Verifier reverts Expired | FRESH (FRESH) | would succeed | TP | same tx |

### Source availability

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S5 | 5 of 5 sources online | healthy | 5/5 · 0 | FRESH | FRESH (FRESH) | would succeed | TN | — |
| S4 | 4 of 5 sources online | healthy | 4/5 · 0 | FRESH (redundancy remains) | FRESH (FRESH) | would succeed | TN | — |
| S3 | 3 of 5 sources online (minimum quorum) | degraded | 3/5 · 0 | WATCH: borrowing limited (no redundancy left) | WATCH (WATCH) | would succeed | MATCH | 1 s |
| S2 | 2 of 5 sources online (quorum impossible) | risk | 2/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min |
| S1 | 1 of 5 sources online (quorum impossible) | risk | 1/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 61 min |
| S0 | 0 of 5 sources online (quorum impossible) | risk | 0/5 · 0 | PROTECTIVE once the last round is stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 50 min |

### Recovery

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Recovery after an attack | risk | 5/5 · 1 | DISPUTED → RECOVERING → FRESH, never earlier than the delay | FRESH (DISPUTED → RECOVERING → FRESH) | would succeed | TP | 0 s |
| R2 | Relapse during recovery | risk | 5/5 · 5 | Never reopens between the two pumps | PROTECTIVE (PROTECTIVE → RECOVERING → WATCH → FRESH) | would revert | TP | 0 s |
| R3 | Oracle outage, then recovery | risk | 0/5 · 0 | PROTECTIVE → RECOVERING → FRESH after new round + delay | FRESH (FRESH → PROTECTIVE → RECOVERING) | would succeed | TP | 50 min |

## 6. Holdout suite — final rules

| ID | Case | Truth | Sources online · manipulated | Expected (policy) | Actual final state (states seen) | Borrow probe (final) | Outcome | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X1 | Rally +1%/h for 6 h | healthy | 5/5 · 0 | Ideally FRESH | WATCH (FRESH → WATCH) | would succeed | FP | — |
| X2 | Rally +3%/h for 5 h | healthy | 5/5 · 0 | Ideally FRESH | PROTECTIVE (FRESH → WATCH → PROTECTIVE) | would revert | FP | — |
| X3 | Decline −1%/h for 6 h | healthy | 5/5 · 0 | Ideally FRESH | PROTECTIVE (FRESH → PROTECTIVE) | would revert | FP | — |
| X4 | Step −4% then flat | healthy | 5/5 · 0 | Ideally FRESH | FRESH (PROTECTIVE → RECOVERING → FRESH) | would succeed | FP | — |
| X5 | Noise ±1.5% for 6 h | healthy | 5/5 · 0 | Ideally FRESH | FRESH (FRESH) | would succeed | TN | — |
| X6 | Spike +4% then back | healthy | 5/5 · 0 | Ideally FRESH | RECOVERING (WATCH → FRESH → PROTECTIVE → RECOVERING) | would revert | FP | — |
| X7 | Flat, 4 of 5 sources | healthy | 4/5 · 0 | Ideally FRESH | FRESH (FRESH) | would succeed | TN | — |
| X8 | Pump +20% held 2 h | risk | 5/5 · 5 | Restricted while the manipulation lasts | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| X9 | Pump +45% held 2 h | risk | 5/5 · 5 | Restricted while the manipulation lasts | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| X10 | Pump +150% held 1 h | risk | 5/5 · 5 | Restricted while the manipulation lasts | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| X11 | Pump +45% held 8 h, thin market | risk | 5/5 · 5 | Restricted while the manipulation lasts | FRESH (PROTECTIVE → RECOVERING → FRESH) | would succeed | FN | 0 s |
| X12 | Creeping +6%/h for 6 h | risk | 5/5 · 5 | Restricted | PROTECTIVE (WATCH → PROTECTIVE) | would revert | TP | 1 s |
| X13 | 3 colluding sources at +20%, only theirs relayed | risk | 5/5 · 3 | PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 1 s |
| X14 | 4 colluding sources at +100%, only theirs relayed | risk | 5/5 · 4 | PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| X15 | 2 of 5 sources at +20%, all relayed | risk | 5/5 · 2 | DISPUTED | DISPUTED (DISPUTED) | would revert | TP | 0 s |
| X16 | Feed frozen, market −15% | risk | 5/5 · 0 | PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 0 s |
| X17 | Feed frozen, market −60% | risk | 5/5 · 0 | PROTECTIVE | PROTECTIVE (PROTECTIVE) | would revert | TP | 1 s |
| X18 | 1 of 5 sources online for 90 min | risk | 1/5 · 0 | PROTECTIVE once stale | PROTECTIVE (FRESH → PROTECTIVE) | would revert | TP | 45 min |
| X19 | 3 of 5 sources, rising market | degraded | 3/5 · 0 | WATCH (minimum quorum) | WATCH (WATCH) | would succeed | MATCH | 1 s |

## 7. False positives and false negatives, case by case

### Final rules — main suite

#### H3 — Legitimate strong rally (+2%/h) (FP)

- **Scenario:** A real, sustained rally of 2% per hour for 6 hours; sources and feed report it honestly.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_WATCH, VAT_ABOVE_EFFECTIVE
- **States entered:** FRESH → WATCH → PROTECTIVE (final PROTECTIVE); restricted at 5 of 6 pokes, 2 fully blocked
- **Other rule set:** FP, final WATCH, 0 blocked pokes
- **Why:** The rally moves the price 3%+ away from its 6 h TWAP within two hours (TWAP_DEVIATION_WATCH → WATCH). Two hours later the OSM passes the higher price to the Vat, which then lends more than 2% above min(attested, TWAP) = the lagging TWAP (VAT_ABOVE_EFFECTIVE → PROTECTIVE).
- **Was the restriction appropriate?** WATCH is defensible — a sustained 2%/h move is indistinguishable from a creeping manipulation at this point. The freeze applies the explicit conservative-valuation rule: the Vat lends above the 6 h average. Accepted as a cost.
- **Potential mitigation:** The GRADED candidate limits instead of freezing here (evaluated, rejected because it weakens sustained-attack protection). A volatility-scaled TWAP band would reduce WATCH in genuine trends.

#### H4 — Temporary volatility (+6% spike, then back) (FP)

- **Scenario:** One hour at +6%, then the price returns to $2,500 and stays there for 3 hours.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_WATCH, VELOCITY_WATCH, VAT_ABOVE_EFFECTIVE
- **States entered:** WATCH → PROTECTIVE → RECOVERING → FRESH (final FRESH); restricted at 4 of 5 pokes, 2 fully blocked
- **Other rule set:** FP, final FRESH, 2 blocked pokes
- **Why:** The +6% spike trips TWAP and velocity WATCH. When the price returns, the OSM still carries the spiked price for up to 2 hours, so the Vat lends 6% above the market (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING, then FRESH.
- **Was the restriction appropriate?** Partly. During the OSM lag the Vat genuinely overvalues collateral by 6%, so freezing new debt is the designed protection. The case returns to FRESH on its own — no permanent freeze.
- **Potential mitigation:** Grade small overvaluation (e.g. 2–5% → WATCH, beyond → PROTECTIVE) instead of freezing at 2%, or account for the OSM's queued next price.

#### H5 — Extreme but legitimate move (+25% in 1 h) (FP)

- **Scenario:** A genuine repricing: +25% within an hour, then held for 3 hours. Nothing is manipulated.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_PROTECT, VELOCITY_PROTECT, VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH
- **States entered:** PROTECTIVE (final PROTECTIVE); restricted at 4 of 4 pokes, 4 fully blocked
- **Other rule set:** FP, final RECOVERING, 4 blocked pokes
- **Why:** A +25% move in one hour exceeds the 20%/h velocity and 15% TWAP protect thresholds; once the OSM catches up, VAT_ABOVE_EFFECTIVE also holds.
- **Was the restriction appropriate?** By design. A genuine repricing of this size cannot be told apart from a pump using price data alone; freezing new debt while repayments stay open is the intended trade-off.
- **Potential mitigation:** An independent signal (volume, multi-venue confirmation) would be needed to distinguish a real repricing — not available in this prototype.

#### H6 — Legitimate decline (−10% in 1 h) (FP)

- **Scenario:** A genuine −10% move. Multipli's OSM delays prices by 1 h, so the Vat briefly lends above the market.
- **Ground truth:** healthy
- **Triggered signals:** VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH, VELOCITY_WATCH
- **States entered:** PROTECTIVE → RECOVERING → WATCH (final WATCH); restricted at 4 of 4 pokes, 3 fully blocked
- **Other rule set:** FP, final WATCH, 3 blocked pokes
- **Why:** A −10% move leaves Multipli's OSM (and so the Vat) 10% above the market for up to 2 hours: VAT_ABOVE_EFFECTIVE → PROTECTIVE, then RECOVERING, then WATCH (TWAP deviation).
- **Was the restriction appropriate?** Yes in substance: the Vat really lends 10% above the market during the lag — the stale-price exposure v1 was built to stop. Counted as a false positive only because the market itself is honest.
- **Potential mitigation:** None proposed for the freeze; the residual WATCH could shorten with a trend-aware TWAP band.

#### A4 — Sustained manipulation, deep-market assumption (FN)

- **Scenario:** Same 9-hour hold, but governance's depth assumption says the market is deep ($250k per 1%). Once the TWAP absorbs the pump nothing flags it.
- **Ground truth:** risk
- **Observed signals:** TWAP_DEVIATION_PROTECT, VELOCITY_PROTECT, VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH
- **States entered:** PROTECTIVE → RECOVERING → FRESH (final FRESH)
- **Other rule set:** FN, final FRESH
- **Why:** Protected for 6 of 10 hours (TWAP protect, velocity, Vat above effective). Once $4,000 fills the 6 h window every deviation signal is zero, and with the deep-market depth assumption the cost gate reports LOW: RECOVERING, then FRESH while the manipulation continues.
- **Security implication** Borrowing reopens at the manipulated price. Exposure is bounded — FRESH headroom never exceeds the epoch growth cap (100,000 rwaUSD per day) — but not prevented. Known Detection Boundary 1.
- **Possible future improvement:** Longer or multi-window TWAPs, reopening in WATCH for a probation period, or an external liquidity signal instead of a static depth assumption.

#### A6 — Sub-threshold manipulation (+2.5%) (FN)

- **Scenario:** A small +2.5% manipulation reported by all sources. Below every watch threshold — and, at a 140% liquidation ratio, not profitable (needs > +40%).
- **Ground truth:** risk
- **Observed signals:** none
- **States entered:** FRESH (final FRESH)
- **Other rule set:** FN, final FRESH
- **Why:** +2.5% is below the 3% TWAP watch band and the 5%/h velocity band, and the cost gate finds nothing extractable below the 40% minimum profitable inflation.
- **Security implication** Undetected by design. At a 140% liquidation ratio a 2.5% overvaluation cannot by itself create bad debt; it slightly increases borrowing capacity. Known Detection Boundary 2.
- **Possible future improvement:** Tighter bands would catch it but raise false positives (see H3, X1); not changed.

### Final rules — holdout suite

#### X1 — Rally +1%/h for 6 h (FP)

- **Scenario:** Honest rally.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_WATCH
- **States entered:** FRESH → WATCH (final WATCH); restricted at 3 of 6 pokes, 0 fully blocked
- **Other rule set:** FP, final WATCH, 0 blocked pokes
- **Why:** A +1%/h rally is 3% above its 6 h TWAP after about 4 hours (TWAP_DEVIATION_WATCH).
- **Was the restriction appropriate?** Limited borrowing only, never frozen. Conservative for a slow honest trend.
- **Potential mitigation:** The fixed 3% band is not volatility-aware; a band scaled to recent realised volatility would reduce this.

#### X2 — Rally +3%/h for 5 h (FP)

- **Scenario:** Honest strong rally.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_WATCH, VAT_ABOVE_EFFECTIVE
- **States entered:** FRESH → WATCH → PROTECTIVE (final PROTECTIVE); restricted at 4 of 5 pokes, 2 fully blocked
- **Other rule set:** FP, final WATCH, 0 blocked pokes
- **Why:** A +3%/h rally: TWAP WATCH from the first hour; after two OSM hops the Vat lends more than 2% above the lagging TWAP (VAT_ABOVE_EFFECTIVE → PROTECTIVE).
- **Was the restriction appropriate?** Same pattern as H3: a conservative-valuation freeze during a strong honest trend.
- **Potential mitigation:** As H3. Under the rejected GRADED candidate this case is WATCH-only.

#### X3 — Decline −1%/h for 6 h (FP)

- **Scenario:** Honest decline.
- **Ground truth:** healthy
- **Triggered signals:** VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH
- **States entered:** FRESH → PROTECTIVE (final PROTECTIVE); restricted at 5 of 6 pokes, 5 fully blocked
- **Other rule set:** FP, final PROTECTIVE, 5 blocked pokes
- **Why:** In a −1%/h decline the OSM's queued price keeps the Vat 2%+ above the market (VAT_ABOVE_EFFECTIVE → PROTECTIVE) for 5 of 6 hours.
- **Was the restriction appropriate?** The Vat does overvalue collateral by ~2%, so the rule works as written, but freezing for a slow honest decline is heavy-handed. This is the clearest cost of a fixed 2% tolerance against a 1–2 h lagged price.
- **Potential mitigation:** Grade overvaluation (small → WATCH) or size the tolerance from the OSM delay and typical hourly volatility. Recorded as future work, deliberately not tuned against this suite.

#### X4 — Step −4% then flat (FP)

- **Scenario:** Honest one-hour −4% move, then 3 flat hours.
- **Ground truth:** healthy
- **Triggered signals:** VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH
- **States entered:** PROTECTIVE → RECOVERING → FRESH (final FRESH); restricted at 3 of 4 pokes, 3 fully blocked
- **Other rule set:** FP, final FRESH, 3 blocked pokes
- **Why:** A −4% step leaves the Vat 4% above the market during the OSM lag (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING, then FRESH.
- **Was the restriction appropriate?** Yes in substance (a real 4% overvaluation for up to 2 hours); returns to FRESH on its own.
- **Potential mitigation:** As X3.

#### X6 — Spike +4% then back (FP)

- **Scenario:** Honest one-hour +4% spike, then back to $2,500.
- **Ground truth:** healthy
- **Triggered signals:** TWAP_DEVIATION_WATCH, VAT_ABOVE_EFFECTIVE
- **States entered:** WATCH → FRESH → PROTECTIVE → RECOVERING (final RECOVERING); restricted at 3 of 4 pokes, 2 fully blocked
- **Other rule set:** FP, final RECOVERING, 2 blocked pokes
- **Why:** The +4% spike trips TWAP WATCH; after the price returns, the OSM still holds the spiked price (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING.
- **Was the restriction appropriate?** As H4: a real, temporary overvaluation that clears itself.
- **Potential mitigation:** As H4.

#### X11 — Pump +45% held 8 h, thin market (FN)

- **Scenario:** The market is manipulated +45% and every source honestly reports it; held 8 h (depth assumption $2,000/1%).
- **Ground truth:** risk
- **Observed signals:** TWAP_DEVIATION_PROTECT, VELOCITY_PROTECT, VAT_ABOVE_EFFECTIVE, TWAP_DEVIATION_WATCH
- **States entered:** PROTECTIVE → RECOVERING → FRESH (final FRESH)
- **Other rule set:** FN, final FRESH
- **Why:** As A4: protected for 6 of 8 hours, then the +45% price fills the TWAP window. With depth assumed at $2,000 per 1% the cost gate still reports LOW, because the Sentinel's bounded 50,000 headroom leaves little to extract, so borrowing reopens.
- **Security implication** Bounded, not prevented: the cost gate behaves as designed (little is extractable within the capped headroom), but the manipulated price becomes the lending price.
- **Possible future improvement:** As A4.

The baseline rules are identical to the final rules (§2), so their FP/FN analysis is the same; their raw results are in `validation/baseline/`. "Other rule set" in each entry above is the rejected GRADED candidate's outcome for the same case.

## 8. Known detection boundaries

These are limits of what Origin claims, not hidden failures:

1. **Long-duration manipulation can enter the TWAP.** A price held longer than the 6.0 h window stops looking like a deviation (A4). The epoch cap and WATCH headroom bound exposure; they do not detect it.
2. **Small manipulation stays below thresholds.** Moves under 3% (and under 5%/h) are not flagged (A6). At a 140% liquidation ratio such moves cannot create bad debt on their own.
3. **The cost gate depends on the depth assumption.** It is only as good as governance's market-depth input.
4. **A compromised source majority passes the verifier.** Only the economic layer can object (V3–V5), and only when the move is large or fast enough.
5. **Demo sources are controlled test keys**, not independent data providers.
6. **Prototype:** not audited, not integrated with Multipli; liquidations and collateral withdrawal are outside its scope.

## 9. Manipulation-cost methodology (as implemented in `src/risk/CostModel.sol`)

```
d               price inflation the attacker aims for (fraction)
D               governance depth ASSUMPTION: USD that moves the price by 1%   (default $250,000)
H               new debt the attacker could take now = the Sentinel's FRESH headroom
mat             liquidation ratio (140%)
lossShare       assumed share of (capital × move) lost unwinding the position (50%)

capital(d)      = D × (d in %)
cost(d)         = capital(d) × d × lossShare
extractable(d)  = H × max(0, 1 − mat / (1 + d))
ratio           = cost / extractable at d0 + 5, 15, 30, 60 points (d0 = mat − 1, the minimum profitable inflation); the lowest ratio decides
LOW ≥ 3× · ELEVATED 1–3× (→ WATCH) · HIGH < 1× (→ PROTECTIVE) · no/stale depth → INSUFFICIENT DATA (→ WATCH)
```

Note that cost includes the factor d: the attacker's modelled loss grows with both the capital deployed and the size of the move.
This is a simplified economic proxy. It does not model order books, multiple venues, flash loans, MEV, cross-venue arbitrage,
liquidation cascades or non-linear slippage. A LOW verdict means *under the stated assumptions, the modelled attack cost exceeds
the modelled extractable value* — not that an attack is impossible.

## 10. Sensitivity analysis (every point from `ASORiskEngine.quote()`)

| Depth $/1% | Headroom H | d | Capital | Cost | Extractable | Cost / extractable |
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

| Depth $/1% | Headroom H | Gate verdict | Most attractive d | Ratio |
|---|---|---|---|---|
| $1,000 | 50,000 | ELEVATED | +70% | 2.78× |
| $1,000 | 950,000 | HIGH CONCERN | +70% | 0.15× |
| $25,000 | 50,000 | LOW CONCERN | +70% | 69.42× |
| $25,000 | 950,000 | LOW CONCERN | +70% | 3.65× |
| $250,000 | 50,000 | LOW CONCERN | +70% | 694.17× |
| $250,000 | 950,000 | LOW CONCERN | +70% | 36.53× |

Headroom 50,000 is the Sentinel's bounded FRESH headroom; 950,000 is the unprotected baseline's remaining capacity.

## 11. Historical validation

### Synthetix sKRW oracle incident (2019-06-25)

- **Historical fact:** One commercial price API intermittently reported the Korean won about 1000x too high. Because of an unrelated outage only two APIs were serving the KRW feed, and the oracle averaged the two remaining prices, propagating the error. Trading bots converted into sKRW during the mispricing window; the operator agreed to reverse the trades for a bug bounty. The oracle was halted and redundant feeds were added.
- **Sources:** [Synthetix blog — Response to Oracle Incident](https://blog.synthetix.io/response-to-oracle-incident/)
- **Retrospective mapping (our interpretation):** Two things Origin's verifier checks: with only 2 of 5 sources a round cannot reach the 3-of-5 quorum (no new price is accepted; the last one ages out → PROTECTIVE), and a 1000x outlier signed next to honest sources makes the spread exceed 1% → DISPUTED.
- **Reproduced pattern (synthetic):** S2 (TP, final PROTECTIVE), M1 (TP, final DISPUTED), F3 (TP, final DISPUTED)
- **Not modeled:** Averaging logic of the historical oracle; FX-API data; the synthetic-asset exchange itself.

### bZx oracle manipulation (second attack) (2020-02-18)

- **Historical fact:** Within a single transaction the attacker moved the sUSD/ETH price on Uniswap and a Kyber reserve, which bZx used together as its price oracle. Qin et al. report a profit of 2,381.41 ETH (about $634.9k) for this attack.
- **Sources:** [Qin, Zhou, Livshits, Gervais — Attacking the DeFi Ecosystem with Flash Loans for Fun and Profit (FC 2021)](https://arxiv.org/abs/2003.03810)
- **Retrospective mapping (our interpretation):** Origin does not read on-chain spot prices: it accepts off-chain signed rounds with freshness and a 1% agreement rule. If sources nevertheless reported a sudden manipulated jump, the velocity and TWAP-deviation signals are the relevant ones.
- **Reproduced pattern (synthetic):** A2 (TP, final PROTECTIVE)
- **Not modeled:** Flash-loan atomicity and on-chain AMM spot oracles: the prototype has no DEX and sources sign off-chain.

### Compound DAI liquidation event (2020-11-26)

- **Historical fact:** The price feed was a Coinbase-reported price, anchored to within 20% of Uniswap's time-weighted average price. DAI traded at about $1.30 on Coinbase Pro; 124 addresses were liquidated and liquidators repaid a total of 85.2 million DAI.
- **Sources:** [Compound Community Forum — DAI Liquidation Event](https://www.comp.xyz/t/dai-liquidation-event/642)
- **Retrospective mapping (our interpretation):** A +30% move of the reported price corresponds to Origin's velocity (≥ 20%/h) and TWAP-deviation (≥ 15%) PROTECTIVE signals. Origin only gates NEW borrowing.
- **Reproduced pattern (synthetic):** A2 (TP, final PROTECTIVE)
- **Not modeled:** Liquidations: Origin never changes the collateral price and no liquidation module is deployed, so the main harm in this incident (liquidations at a spiked price) is outside Origin's scope.

### Inverse Finance INV price manipulation (2022-04-02)

- **Historical fact:** The INV price came from a Keep3rV2 TWAP oracle on a SushiSwap INV-ETH pair with small reserves (CertiK: 432 INV / 46 ETH before the swap); a timing check in the oracle update was bypassed, so the manipulated price was used. No flash loan was used: the attacker used their own capital. The attacker borrowed 1,588 ETH, 94 WBTC, about 4 million DOLA and 39 YFI; CertiK estimated the loss at about $14.5 million (Inverse Finance's own post-mortem reports its figures separately).
- **Sources:** [CertiK — Inverse Finance 02 April 2022](https://www.certik.com/resources/blog/inverse-finance-02-april-2022); [Inverse Finance — INV Price Manipulation Incident (post-mortem)](https://medium.com/inverse-finance/inv-price-manipulation-incident-55ea0433f4fc)
- **Retrospective mapping (our interpretation):** Thin market → the cost gate (low depth assumption makes manipulation look cheap) plus TWAP/velocity. The incident is also a reminder of Origin's own limit: a TWAP can be manipulated or absorb a sustained move.
- **Reproduced pattern (synthetic):** A1 (TP, final PROTECTIVE), A3 (TP, final WATCH), A4 (FN, final FRESH)
- **Not modeled:** The specific TWAP sampling bug and the AMM pool; Origin's TWAP is computed from signed rounds, not a DEX.

### Venus Protocol LUNA price floor (2022-05-12)

- **Historical fact:** Chainlink's LUNA/USD feed hit its price-floor threshold and stopped at $0.107 while LUNA traded around $0.01. Per Venus's statement, two accounts deposited about 230 million LUNA and borrowed about $13.5 million; the loss was about $11 million, covered from Venus's risk fund.
- **Sources:** [The Record (Recorded Future News) — Venus Protocol exploit, quoting Venus's statement](https://therecord.media/collapse-of-luna-cryptocurrency-leads-to-11-million-exploit-on-venus-protocol); [Venus Protocol — LUNA Incident Update 2](https://medium.com/venusprotocol/venus-protocol-luna-incident-update-2-c334475d9214)
- **Retrospective mapping (our interpretation):** The lending market's price was far above the real market. If independent sources report the real price, Origin's Vat-above-effective-price check (> 2%) restricts borrowing; a frozen upstream feed is also caught by Multipli's adapter staleness (24 h).
- **Reproduced pattern (synthetic):** F1 (TP, final PROTECTIVE), F2 (TP, final PROTECTIVE)
- **Not modeled:** A feed that stays 'fresh' but floored: Origin relies on its own signed sources seeing the real price.

### Mango Markets MNGO manipulation (2022-10-11)

- **Historical fact:** According to the CFTC, MNGO was bought rapidly on three exchanges that were the inputs of Mango's oracle; the oracle price rose over 13-fold within 30 minutes. The inflated value was used to borrow and withdraw over $110 million (SEC: about $116 million). These are regulators' allegations; a federal judge later overturned the criminal convictions.
- **Sources:** [CFTC press release 8647-23](https://www.cftc.gov/PressRoom/PressReleases/8647-23); [SEC press release 2023-13](https://www.sec.gov/newsroom/press-releases/2023-13); [TRM Labs — convictions overturned](https://www.trmlabs.com/resources/blog/breaking-federal-judge-overturns-all-criminal-convictions-in-mango-markets-case-against-avraham-eisenberg)
- **Retrospective mapping (our interpretation):** Every oracle input reported the manipulated market: the exact case a source quorum cannot catch. Origin's velocity, TWAP-deviation and cost-gate signals are the relevant layer.
- **Reproduced pattern (synthetic):** A1 (TP, final PROTECTIVE), V5 (TP, final PROTECTIVE)
- **Not modeled:** Perpetual-swap mechanics and the real MNGO order books; our pump is +60% on synthetic prices, not 13x.

No historical market data is replayed, and no claim is made that Origin would have prevented any of these incidents.

## 12. Reproducibility check

- **main suite:** 38 cases compared; outcome or final state differs in **0**; the per-poke state sequence differs in **0**.
- **holdout suite:** 19 cases compared; outcome or final state differs in **0**; the per-poke state sequence differs in **1** (X2: WATCH→PROTECTIVE vs FRESH→WATCH→PROTECTIVE).

Baseline and final use identical rules, so these two runs measure run-to-run reproducibility. anvil's block timestamps advance
with a few seconds of wall-clock time between transactions; a case whose price sits exactly on a threshold can therefore flip
the state of an individual poke between runs. `--check` compares outcome and final state, which is what the metrics use.

## 13. Reproduce

```bash
forge build
cd demo && npm ci
npm run validate                                   # final rules (deployed default), main + holdout
npm run validate -- --rules=baseline               # original rules, main + holdout
npm run validate -- --rules=candidate-graded       # the evaluated, rejected alternative
npm run validate -- --report                       # regenerate this file from validation/*.json
```
