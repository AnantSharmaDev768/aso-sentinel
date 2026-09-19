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
