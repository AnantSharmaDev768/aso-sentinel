# Architecture and threat model

## Components and trust

| Component | Code | Trust / privileges |
|---|---|---|
| Price sources (5) | off-chain; demo uses anvil test keys | Authorized signers in `ASOVerifier`. Any 3 that agree within 1% produce an `OK` price. |
| Relayer | anyone | Submits signed rounds. It cannot forge prices. With more than N valid signatures it can choose which N to submit (bounded by the 1% agreement band). |
| `ASOVerifier` | ours | No external calls. Owner manages the source set and parameters within hard bounds. Guardian or owner can halt; only the owner can unhalt. |
| Keeper | anyone | Calls `ASOSentinel.poke()`. Poking more often can only move the ceiling toward the correct state. |
| `ASOSentinel` | ours | A **ward of the protected Vat**. Its code only ever calls `vat.file(ilk, "line", x)`, with `x ∈ {0} ∪ [0, maxLine]`. Its dependencies are immutable. Owner sets `maxLine`, `gap` and `maxPriceGapBps` within bounds. |
| Vat, Spotter, OSM, PriceFeedAdapter, GemJoin5 | Multipli, unmodified | As deployed by Multipli. |

## What happens on `poke()`

1. Read `ASOVerifier.status()`, which is time-evaluated. Anything other than `OK` means restrict
   (`ASO_HALTED`, `ASO_DISPUTED`, `ASO_NO_DATA`, `ASO_STALE`).
2. Call `PriceFeedAdapter.peek()` (Multipli's own staleness rule). `has = false` **or a revert** means
   restrict (`FEED_STALE`). This is the signal the OSM ignores.
3. Invert the Spotter's formula to get the price the Vat is actually lending at:
   `vatPrice = spot · mat / RAY · par / RAY / 1e9`, rounded up. If
   `vatPrice > attestedPrice · (1 + maxPriceGapBps)`, restrict (`VAT_PRICE_ABOVE_ATTESTED`). A Vat
   price *below* the attested price is conservative and allowed.
4. When restricting: `line = 0`, and record the verifier's `lastNonce` as `restrictedAtNonce`.
5. When healthy but still restricted: stay closed (`AWAITING_FRESH_ROUND`) until
   `lastAcceptedNonce > restrictedAtNonce`. Then open with `line = min(debt + gap, maxLine)`.

The Vat enforces the result itself. For `dart > 0`, `frob` requires `Art·rate ≤ line`, so a ceiling
of 0 rejects every new debt. For `dart ≤ 0` (repay) the ceiling check is skipped, and for
`dart ≤ 0, dink ≥ 0` the safety check is skipped as well.

## Threat model

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| T1 | Forged or tampered price | EIP-712 signature per attestation; recovered signer must equal `source` and be authorized | `test_RevertWhen_PriceTamperedAfterSigning`, `testFuzz_AnyTamperedFieldInvalidatesSignature`, demo S4 |
| T2 | One source counted multiple times | Sources must be strictly ascending by address | `test_RevertWhen_DuplicateSource`, demo S4 |
| T3 | Too few sources / minority collusion | `n ≥ quorum`; quorum must be a strict majority (`2N > M`), enforced on every source-set change | `test_RevertWhen_QuorumNotMet`, `test_QuorumMustBeStrictMajority`, `test_AddingSignerThatBreaksMajorityReverts` |
| T4 | Replay of an old or identical round | Round nonce strictly increasing; disputed rounds consume their nonce | `test_RevertWhen_ExactReplayOfAcceptedRound`, `test_RevertWhen_ReplayOfDisputedRound`, `testFuzz_ReplayAlwaysRejected`, demo S5 |
| T5 | Cross-chain / cross-contract replay | EIP-712 domain includes chainId and verifyingContract (OZ `EIP712`, recomputed if the chain forks) | `test_RevertWhen_SignatureFromOtherChain`, `test_RevertWhen_SignatureForOtherVerifierContract` |
| T6 | Signature malleability | OZ `ECDSA.tryRecover` rejects high-s | `test_RevertWhen_HighSMalleableSignature` |
| T7 | Stale data treated as fresh | Checked at submit (`maxAge`, `validUntil`, future-dated `validAfter`); **re-checked at read time**; later rounds cannot carry older observations | `test_StatusBecomesStaleAfterMaxAge_WithoutAnyTransaction`, `test_RevertWhen_NewRoundCarriesOlderObservation`, demo S2 |
| T8 | Long-lived signatures | `validUntil − validAfter ≤ maxValidity` (2h) | `test_RevertWhen_ValidityWindowTooLong` |
| T9 | Sources disagree / partial compromise | Spread `(max−min)/median` (rounded up) above 1% ⇒ `DISPUTED` ⇒ restrict | `test_SpreadOneWeiAboveToleranceIsDisputed`, demo S3 |
| T10 | Upstream feed frozen; OSM serves stale price | Sentinel reads Multipli's adapter validity and compares the Vat price with fresh attested data | `test_S6a_…`, `test_S6b_…`, demo ACT 4 |
| T11 | Restriction blocks repayment | Sentinel only lowers `line`; Vat skips the ceiling check for `dart ≤ 0` | `test_S8_…`, `invariant_RepaymentsNeverBlocked`, demo S8 |
| T12 | Restriction triggers liquidations | Sentinel never writes `spot` | `test_SentinelNeverChangesSpot`, `invariant_PokeNeverChangesSpot` |
| T13 | Repaid room re-borrowed at a bad price | Restricted ceiling is 0, not current debt | `test_RepaidRoomCannotBeReborrowedWhileRestricted` (fails under the "current debt" mutant) |
| T14 | Premature recovery | Healthy **and** a new accepted round after the incident | `test_RecoveryRequiresNewAcceptedRound`, demo ACT 5 |
| T15 | Feed call reverts / DoS on poke | `try/catch` on the adapter, treated as stale (fail closed). Verifier loops are bounded (≤16 signers). No token transfers or callbacks. | `test_Restricts_WhenFeedReverts_FailClosed` |
| T16 | Sentinel over-privilege | Its only Vat call is `file(ilk,"line")`; never above `maxLine`; no generic call path; dependencies immutable | `invariant_LineNeverAboveMaxLine`, code review |
| T17 | No one pokes | Exposure bounded by headroom at the last healthy poke (≤ `gap` plus repaid amount) | `test_KeeperLag_ExposureBoundedByHeadroom` |
| T18 | Collateral withdrawal at a stale-high price | **Not mitigated** (needs a Vat-level hook or changing `spot`) | `test_KnownLimitation_CollateralWithdrawalAtStalePriceNotBlocked` |

## Units

- Prices: WAD (1e18 USD per collateral unit). The adapter converts Chainlink's 8 decimals.
- `spot`: RAY. `line`, `debt` and `gap`: RAD (1e45).
- Checked arithmetic: Solidity 0.8 throughout our code. The verifier caps prices at `uint128`, so
  spread and median maths cannot overflow.
