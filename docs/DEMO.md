# 2–3 minute live demo

**Setup (before judging):** `forge build`, then `cd demo && npm ci`, then run `npm run demo` once to warm
up (about 10s). No internet is needed after installation. Have a terminal with a large font and the
README architecture diagram ready.

**Run:** `npm run demo:step`. It pauses before each act; press Enter to continue.
**Fallback if the demo breaks:** run `forge test --match-contract AttackScenariosTest -vv`, which shows
the same scenarios as tests. As a last resort, show the recorded output (see the submission checklist).

| Time | Say | Screen shows (expected) |
|---|---|---|
| 0:00–0:20 | "Multipli's rwaUSD is a MakerDAO fork. We downloaded its verified mainnet contracts — Vat, Spotter, OSM, PriceFeedAdapter — and run them unmodified on a local chain, twice: a baseline and a protected copy that share one price feed." | Setup lines with the baseline Vat, protected Vat, verifier and Sentinel addresses. |
| 0:20–0:40 | **Act 1.** "Five independent sources sign EIP-712 price attestations. Any three that agree make a round. The Sentinel sees healthy data and opens a bounded borrowing window. Alice borrows 100k on both systems." | `✔ SUCCESS` for `submitRound`, `poke`, and both borrows. STATE: ASO `OK`, protected line 200,000. |
| 0:40–1:00 | **Act 2.** "Attacks on the data itself. A forged price, an outsider key, the same source counted twice, a replayed round — every one reverts on-chain." | Four `✖ REVERTED` lines: `InvalidSignature(1)`, `UnauthorizedSigner(…)`, `SignersNotStrictlyAscending(2)`, `NonceNotIncreasing(2, 2)`. |
| 1:00–1:25 | **Act 3.** "Sources disagree by more than 1%. The round is recorded as DISPUTED, not silently dropped. The Sentinel closes the debt ceiling to zero: Bob's borrow reverts, but Alice can still repay. When the sources agree again, borrowing reopens." | STATE: `DISPUTED`. `✖ REVERTED` Bob borrow `Vat/ceiling-exceeded`. `✔` Alice repay 20,000. `✔` Bob borrow after the recovery round. |
| 1:25–2:10 | **Act 4 (the key moment).** "The market drops to $1,500 but the Chainlink-style feeder freezes. Multipli's OSM keeps serving $2,500 as valid. On the **baseline**, Mallory deposits $150k of collateral and mints 178k rwaUSD: that's bad debt. On the **protected** Vat the same borrow reverts. Then 25 hours of silence: Multipli's own adapter says 'stale', the OSM still says 'valid', and the baseline keeps lending while we stay closed. An expired attestation can't be submitted either." | STATE: OSM $2,500 `has=true`, ASO $1,500. `✔ SUCCESS` Mallory borrows 178,000 on BASELINE; `✖ REVERTED` on PROTECTED. STATE after 25h: adapter `NO (stale)`, OSM `has=true`, ASO `STALE`. `✖ REVERTED` `Expired(0)`. `✔` baseline borrow; `✖` protected borrow; `✔` Alice repay. |
| 2:10–2:35 | **Act 5.** "The feeder recovers and the OSM catches up, but we still wait for a fresh attested round before reopening. Then borrowing works again at the real price." | `poke BEFORE a new round → still closed` (line 0). After the round: `✔` Bob borrow. STATE: line = debt + gap. |
| 2:35–2:50 | **Results.** "Twenty-two expected-versus-actual checks, all from mined transactions. We never touch the price, so nothing gets liquidated by our intervention. One honest limitation: we can't stop collateral withdrawals against a stale price without a Vat hook — that's documented and tested." | `ALL SCENARIOS BEHAVED AS EXPECTED (22 checks)` |

## Numbers to remember

- Mallory: 100 mPAXG, worth $150,000 at the real price. She borrows 178,000 rwaUSD on the baseline,
  a collateral ratio of about 84%, leaving about $28k of bad debt.
- Tests: 91 passing (unit, fuzz, invariant); 100% branch coverage of our two contracts. All 17 mutants are caught. The demo takes about 10s.
- Parameters matching Multipli mainnet: 140% `mat`, 1h OSM delay, 24h adapter `maxDelay`, 1M ceiling,
  100 rwaUSD dust.

## Dashboard walkthrough (Origin)

**Setup:** `cd app && npm ci && npm run local`, then open <http://localhost:5173>. Everything runs on a private
anvil chain with public test accounts; no wallet or internet is needed.

**Run:** open *Presentation mode* and click each step's **Run** (7 steps, about 3 minutes). The right-hand
panel reads the contracts after every step. **Restart from healthy snapshot** rewinds the chain. The steps
and narration are listed in the README, section 22.

**Fallback:** `cd demo && npm run demo:origin` runs the same sequence in the terminal and prints each
transaction and state.

## 5-minute judge demo (dashboard)

Before judging: `cd app && npm run local`, open <http://localhost:5173> at 100% zoom, press **Reset chain**.

| Time | Screen | Say |
|---|---|---|
| 0:00 | Overview | "DeFi lending depends on price oracles, but multiple sources agreeing does not necessarily mean the market is safe. ASO Sentinel separates authenticity from economic safety." Point at the pipeline: sources → verifier → risk engine → Sentinel → debt ceiling. |
| 0:30 | Overview | "ASOVerifier checks signatures, quorum, freshness, replay protection and source agreement. ASORiskEngine checks the market itself — TWAP deviation, velocity, source divergence, upstream conditions, manipulation economics. OriginSentinel turns that into a borrowing policy. It never changes the price." |
| 1:00 | Presentation, step 1 | "Everything is healthy. Borrowing is open." |
| 1:15 | step 2 | "The sources now disagree. The Sentinel blocks new borrowing." (right panel: DISPUTED, debt ceiling 0) |
| 1:40 | step 3 | "Now every source agrees, but the market is assumed thin. The signatures pass while the economic risk rises." (cost gate ELEVATED) |
| 2:05 | step 4 | "The price is pumped 60%. The risk engine detects it and the Sentinel goes protective." (Bob's borrow: reverted as expected) |
| 2:30 | step 5 | "Repayment still works. We limit additional exposure; we don't trap users." |
| 2:50 | step 6 | "The oracle is healthy again, but the system doesn't forget the incident — RECOVERING, still blocked." |
| 3:10 | step 7 | "After a newer accepted round and the recovery delay, borrowing reopens — limited first, then FRESH." |
| 3:35 | Validation | "We tested the policy on labelled synthetic risk and healthy cases, plus a holdout set. Here are the false positives and false negatives — the policy is deliberately conservative." Open one FP and one FN row. |
| 4:15 | Baseline vs Protected | "Same lending logic, same price path. The difference is the Sentinel-controlled debt ceiling." |
| 4:40 | Evidence | "Here is what is on the public Sepolia testnet (v1 core, source-verified), what is local, and what is modelled. Prototype, not audited, not integrated with Multipli." |

If a step fails: press **Restart from healthy snapshot** in Presentation mode; fallback is `cd demo && npm run demo:origin`.
