# Pre-submission audit — ASO Sentinel

Date: 2026-09-19. Reviewer: Claude (AI), acting as the team's technical reviewer. This is **not** a
third-party security audit.

## 0. Starting point

When the audit began, **no project code existed** on the team machine. We searched the user profile,
all of `D:\`, earlier Claude sessions and public GitHub. The only prior work was research notes from an
earlier session. Everything in this repository was therefore written and verified on 2026-09-19. The
design followed the team's brief, except for one change the team approved: the restricted ceiling is
**0**, not "current debt".

## A. Problem-statement alignment

| Aspect | How it is addressed | Status |
|---|---|---|
| Staleness / latency | Freshness checked at submission and **re-checked at read time**; Multipli's adapter staleness signal is consumed | Implemented + tested |
| Accuracy / manipulation | N-of-M signed quorum; median; cross-source spread ≤ 1%; Vat price vs fresh attested price (≤ 2%) | Implemented + tested |
| Source failure | Missing rounds → `STALE`; disagreeing sources → `DISPUTED`; reverting feed → fail closed | Implemented + tested |
| Resilience | New debt stops, repayments continue, price untouched, recovery gated on new data | Implemented + tested |
| Multipli connection | Runs Multipli's byte-identical verified contracts; parameters match mainnet; aligned with their documented oracle-profile design | Real, local only — **not integrated** |

**Simulated:** price sources (test keys), the Chainlink feed, the PAXG token, time, and the keeper.
**Not deployed:** liquidations (Dog/Clipper), fees (Jug), rwaUSD ERC-20 exit.

## B. Smart-contract security review

| Check | Result |
|---|---|
| EIP-712 domain and typed-data hash | OZ `EIP712("ASO Verifier","1")`; digest independently recomputed in `test_DomainSeparatorBindsChainIdAndContract` ✔ |
| Signature recovery, authorized signers | `tryRecover`; signer must equal the claimed `source` and be in the set; high-s rejected ✔ |
| N-of-M quorum, duplicates | `n ≥ quorum`; strict majority enforced on every change; strictly ascending signers ✔ |
| Disagreement / tolerance | Spread rounded **up**; boundary tested at exactly 1% and at 1% + 1 wei ✔ |
| Freshness, expiry, future timestamps | `maxAge` at submit and at read; `validUntil`; `validAfter ≤ now`; `maxValidity` ✔ |
| Sequence / replay | Nonce strictly increasing; disputed rounds consume the nonce; older observations rejected ✔ |
| Chain and contract binding | Domain includes chainId and verifyingContract; both tested ✔ |
| Zero / overflow / decimals / rounding | Price > 0 and ≤ uint128; 0.8 checked maths; Spotter inversion rounded up (conservative), tested to ±1 wei ✔ |
| Access control / admin abuse | Ownable2Step; bounded parameters; guardian can halt but not unhalt. **Residual:** a single-EOA owner in the demo |
| Emergency pause / recovery | `halt` → `HALTED` → restrict; recovery needs a new round ✔ |
| Reentrancy / external calls | Verifier makes no external calls. Sentinel calls view functions plus `vat.file`, with no token transfers or callbacks. Linter reentrancy-event notes reviewed: false positives ✔ |
| DoS | Signer loops bounded at 16; a reverting feed can't block `poke` (try/catch → fail closed) ✔ |
| State transitions | Invariants: restricted ⇒ line = 0; line ≤ maxLine; no borrow while restricted ✔ |
| Can invalid data enable borrowing? | Not through the Vat ceiling. Invalid, stale, disputed or overvalued data all close the ceiling on `poke`. **Residual:** borrowing within the remaining headroom until someone pokes (bounded) |
| Repayments during restriction | Always possible, subject to Multipli's own dust rule ✔ |
| Ceiling below current debt | Intended (`line = 0`); repay is unaffected; proven safer than "current debt" ✔ |
| Stale price treated as fresh | Prevented in the verifier (read-time status) and in the Sentinel (adapter signal + price-gap check) ✔ |

**Findings fixed during the audit**

1. **High (process): tests could pass on stale bytecode.** Foundry 1.x `dynamic_test_linking` did not
   recompile tests after `src` changes in this project. Mutation testing exposed it: 17/17 mutants
   "survived". Fix: `dynamic_test_linking = false` in `foundry.toml`. After the fix, 17/17 mutants are
   killed.
2. **Medium (design): the "ceiling = current debt" design leaks capacity.** Repaid room could be
   re-borrowed at a bad price. Fix: the restricted ceiling is 0 (team-approved). Regression test added.
3. **Medium (test quality): invariants were close to vacuous.** The random campaign rarely reached the
   open state. Fix: an honest-keeper action; non-vacuity counters are logged.
4. **Low (fidelity): the demo used dust = 0.** Fix: dust = 100 rwaUSD (mainnet value); the invariant
   respects the dust rule.
5. **Low (claims): the diagram placed a mock inside the "Multipli verified" box.** Fixed.
6. **Low (demo reliability): `--step` hung with piped stdin, and receipt polling made the demo take
   4 minutes.** Both fixed; the demo now takes about 10 seconds.

**Residual risks (documented, not fixed):** collateral withdrawal at a stale-high price; keeper
dependency; a single faulty source can force `DISPUTED` (fail-closed); relayer choice within the 1%
band; admin trust; no third-party audit.

## C. Oracle and Multipli architecture

- **Verified:** adapter staleness → `(0,false)`; `OSM.poke` no-ops on invalid source; `OSM.peek` has
  no age check; `Spotter.poke` with `has=false` writes `spot = 0`; `Vat.frob` skips the ceiling check
  for `dart ≤ 0`. Sources are byte-identical to mainnet, and the config was read at block 26,009,365.
- **Correct failure modes:** stale ASO data, disputed data, halted, missing data, stale upstream feed,
  and a Vat price above fresh data. Each has a dedicated test.
- **Price never modified:** tested per-poke and as an invariant.
- **Missing integration assumptions:**
  - Governance must `rely` the Sentinel on the Vat.
  - Real sources and their data are needed.
  - Multipli's mainnet PAXG adapter owner is `0x194E…` (their "Operator wallet"); we did not verify its type.
  - We did not verify the actual Multipli `End`/`Cure` flows or how `DssCdpManager` / proxy actions
    interact with a zero ceiling. They call the same `Vat.frob`, so the same ceiling rule applies, but
    this is untested.

## D. Attack demonstration

All 8 required scenarios run as deterministic Foundry tests **and** as mined transactions in
`npm run demo`. See the scenario table in the README.

## E. Test results (commands actually run, 2026-09-19)

| Command | Result |
|---|---|
| Foundry download + SHA-256 check | v1.8.3 zip hash `e4d7302f…6304` matched the official `.sha256` ✔ |
| `forge clean && forge build --sizes` | ✔ 10 files with solc 0.6.12, 51 files with 0.8.37. Warnings only (vendored-code shadowing, lint notes). runtime size Verifier 8,075 B, Sentinel 4,953 B (limit 24,576 B) |
| `forge fmt --check` | ✔ |
| `forge test` | ✔ **91 passed, 0 failed** (55 verifier, 21 Sentinel, 14 scenario, 1 invariant suite with 6 invariants × 128 runs × 64 calls) |
| Invariants with `--fuzz-seed` 0x1 / 0x2 / 0x3 / 0x5eed | ✔ all pass; the last run of each seed shows 0–5 successful borrows, 3–9 rejected-while-restricted borrows and 0–3 repays |
| `forge coverage` (our contracts) | Sentinel 100% lines/branches; Verifier 98.35% lines, 100% branches/functions |
| `python test/mutation/run_mutations.py` | ✔ **17/17 mutants killed** (only after the dynamic-linking fix; see finding 1) |
| `forge lint` | 29 warnings reviewed: block-timestamp (intended), revert-in-loop (intended all-or-nothing), reentrancy-events / unused-return (trusted views), zero-check (intended). None actionable |
| `node script/vendor/verify-multipli-sources.mjs` | ✔ 10/10 files byte-identical to Blockscout-verified sources |
| `cast call` on mainnet (block 26,009,365) | `mat` 1.4e27, `hop` 3600, `maxDelay` 86400, `line` 1e51 rad, `dust` 2e47 rad, OSM `src` = adapter |
| `forge script script/Deploy.s.sol --broadcast` (anvil) | ✔ deployed; wards and ceilings verified with `cast` |
| `npm install viem@2.56.8` | ✔ 0 vulnerabilities |
| `npm run demo` × 2 | ✔ 22/22 checks each; result tables identical; 12–14 s |
| `npm run demo -- --step` with piped Enter / early EOF | ✔ |
| **Not run** | GitHub Actions (no remote yet), Slither/Aderyn (not installed), testnet deployment, third-party review |

## F. Frontend

There is no web frontend, deliberately, following the team's priorities. The "dashboard" is the demo
runner's STATE panel. Every value in it is read from contracts on each step (feed age, adapter validity,
OSM value and `has`, ASO price, status and nonces, both Vat ceilings and debts, Sentinel state and live
`evaluate()`). No value is hard-coded. A web UI is optional (see the plan).

## G. Hackathon evaluation (no score, no prediction)

| Criterion | Strongest evidence | Weakest point | Improve before submission |
|---|---|---|---|
| Innovation | Wires signed-attestation checks to Multipli's *actual* Vat ceiling, and exposes a verified OSM staleness gap | The building blocks are well-known (Aave Sentinel, DssAutoLine, RedStone, Multipli's own docs) | Say it plainly: "working implementation of a documented design, applied to the deployed system" |
| Real-world impact | Reproduces bad-debt minting with Multipli's real code (178k debt vs $150k collateral) | Local chain only; the scenario requires the upstream feed to fail or freeze, which we did not observe on mainnet | Show the 24h adapter window and the OSM `has=true` behavior with mainnet values |
| Technical execution | 91 tests, invariants, 17/17 mutants killed, 100% branch coverage, byte-verified vendored code | No testnet deploy; no third-party audit | Optional: deploy to a public testnet |
| Usability | One command, about 10 s, deterministic, exit code; permissionless poke | Terminal only; keeper needed | Optional read-only web panel |
| Presentation | `docs/DEMO.md` 2:50 talk track, architecture diagram, honest limitations | Dense terminal output | Rehearse with `demo:step`; record a backup video |

## H. Final release audit

### 1. Executive verdict: **READY WITH FIXES**

The contracts, tests and on-chain demo are complete, verified and reproducible. The remaining items are
submission logistics:
- The repository has **no commits and no remote**.
- There is no recorded backup video yet.
- Nobody else on the team has run it yet on a second machine.

### 2. Critical blockers

1. The code is not committed or pushed. A lost laptop means a lost project.
2. The demo has been run on one machine only. A teammate should run it from a clean clone
   (`git clone --recurse-submodules`, Foundry v1.8.3, Node ≥ 20).

### 3. High-priority fixes (today)

1. Commit, push to the team GitHub repo, and confirm CI is green (the workflow is included).
2. Record a backup video of `npm run demo:step` (about 3 min).
3. Rehearse `docs/DEMO.md` twice against the clock.
4. Put the architecture diagram (`docs/architecture.html`, screenshot) into the slide deck.

### 4. Medium-priority (only if time remains)

1. A read-only web panel that polls the same contract reads as the STATE panel.
2. A public testnet deployment (requires a non-demo deploy script with env-provided keys; never use the
   anvil keys).
3. Keeper incentive or a borrow-path hook design note.
4. Slither/Aderyn run.

### 5. Test results

See section E.

### 6. Demo script

See [DEMO.md](DEMO.md).

### 7. Judge Q&A

| Question | Honest answer |
|---|---|
| Is this integrated with Multipli? | No. It runs Multipli's verified mainnet code locally. Integration would need governance to `rely` the Sentinel on their Vat. |
| Isn't this just Aave's PriceOracleSentinel? | The idea of pausing borrowing on oracle failure is the same, and we credit it. What differs is the implementation for a Maker-style Vat (the ceiling instead of a borrow hook), signed N-of-M attestations, and a demonstrated gap in the deployed OSM. |
| Why not fix the price instead? | Setting a lower or zero price triggers liquidations; Multipli's Spotter writes `spot = 0` on invalid data. Restricting new debt is reversible and harms nobody. |
| What if nobody calls `poke()`? | New debt is bounded by the headroom at the last healthy poke (200k in the demo), not by the stale price. There is no keeper incentive yet; this is a known limitation. |
| Can a malicious source DoS borrowing? | One authorized source can force `DISPUTED`, which pauses new debt only. That is a deliberate fail-closed choice. It cannot move the price or unlock borrowing. |
| Can a relayer cherry-pick prices? | Only among valid signatures that agree within 1%, and the quorum is a strict majority. |
| Can users still withdraw collateral during an incident? | Yes. That is our main limitation: it needs a Vat hook or changing `spot`. It is documented and tested. |
| Does Chainlink PAXG really go stale? | We don't claim it does routinely. Multipli's adapter allows 24h, and the OSM then keeps the last value indefinitely. We demonstrate the consequence if the feed fails. |
| Who are the attestation sources? | In the demo, test keys. In production they would be independent providers, which is out of scope. |
| Were the tests weak? | We mutation-tested them: 17 injected bugs, all caught. We also found and fixed a Foundry caching issue that let stale tests pass. |

### 8. Final submission checklist

- [ ] Code committed and pushed (with submodules)
- [ ] CI green on GitHub
- [x] `forge build` / `forge test` pass (91/91)
- [x] Deterministic on-chain demo (`npm run demo`, 22/22)
- [ ] Demo run by a second teammate from a clean clone
- [x] README with scope and limits, architecture diagram, provenance, audit, demo script
- [ ] Architecture diagram screenshot in slides
- [ ] Backup demo video recorded
- [ ] Pitch rehearsed within 3 minutes
- [x] No production-integration, novelty or winning claims in the repo

### 9. Claims audit

There was no pre-existing README, UI or pitch to audit. These are the claims from the original brief
and common pitch phrasings, rewritten:

| Risky claim | Why | Accurate version |
|---|---|---|
| "Compatible with / integrated into Multipli" | Not deployed or integrated | "Runs Multipli's verified mainnet contracts unmodified on a local chain; integration would require a governance action" |
| "Novel oracle protection" | Aave, Maker, RedStone and Multipli's docs cover it | "A working implementation of the signed-feed and status design Multipli documents, applied to their deployed Vat" |
| "Prevents all oracle attacks / bad debt" | Collateral withdrawal and keeper lag remain | "Blocks new debt on stale, disputed or overvalued data; the remaining exposure is bounded and documented" |
| "Multipli is vulnerable / has a bug" | The OSM behavior is inherited MakerDAO design, and the feed normally updates | "The deployed OSM keeps serving its last price when its source goes stale; we show the consequence if the feed fails" |
| "Real-time multi-source price data" | Sources are test keys | "Five simulated sources signing EIP-712 attestations" |
| "Audited / production-ready" | Neither | "Tested prototype: 91 tests, invariants, mutation testing; not audited" |
| "Sequence numbers per source" | It is one nonce per round | "Strictly increasing round nonce (Multipli's docs call it `nonce`)" |
| "Guaranteed to win / best project" | Never | Don't say it |

### 10. Implementation plan (remaining hours)

1. **Now (+0:30):** commit and push; open CI; a teammate clones and runs `forge test` and `npm run demo`.
2. **+1:00:** fix anything the clean-clone run reveals. Screenshot the diagram into the slides.
3. **+2:00:** write 5–6 slides: problem (verified OSM behavior) → design → demo → evidence → limits →
   prior art.
4. **+2:30:** rehearse `demo:step` with DEMO.md twice; record a backup video.
5. **Optional, only if everything above is done:** read-only web panel, then a testnet deploy.
6. **Freeze:** no contract changes in the last 3 hours before submission, except fixes for failing tests.
