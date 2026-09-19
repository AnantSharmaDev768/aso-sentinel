// Human analysis that accompanies the generated validation numbers.
//
// RULE_CHANGE: the candidate section was written BEFORE any candidate result existed (reasoning, not outcome);
// the "Outcome and decision" section was written after the runs.
// ANALYSIS holds the per-case explanation of every false positive / false negative, written after inspecting the
// recorded signals of each run. The numbers themselves always come from validation/*.json, never from this file.

export const RULE_CHANGE = `**The candidate change (written before any candidate result existed; at that time it was intended to become the default).** One rule: how the Vat's lending price is checked (\`OriginSentinel.vatCheck\`).

| | Baseline rule (CONSERVATIVE) | Candidate rule (GRADED) |
|---|---|---|
| Freeze (PROTECTIVE) | Vat price > **min(attested, 6 h TWAP)** × 1.02 | Vat price > **attested price** × 1.02 |
| Limit (WATCH) | — | Vat price > 6 h TWAP × (1 + TWAP watch band, 3%) |

**Why it was proposed — reasoning independent of the test set.** The 2% tolerance was introduced (v1 \`ASOSentinel\`) to compare two
measurements of the *same current price*: the price the Vat lends at and the price the sources sign now. The baseline rule
compares the Vat with min(attested, TWAP), which in practice is the 6 h average whenever the market is rising. That makes it a
second, undocumented TWAP rule — "freeze at 2% above the average" — which contradicts the documented policy that distance from
the TWAP is graded (3% → WATCH, 15% → PROTECTIVE). The candidate removes that contradiction: overvaluation against the
current market still freezes; lending above the recent average is graded with the same band as every other TWAP signal.
No new threshold was introduced — both comparisons reuse existing parameters (2% tolerance, 3% watch band).

**Security property the candidate preserves.** The Vat must not lend above the current signed market price (the stale-OSM /
frozen-feed case: F1, F2, X16, X17, D in the demo). That freeze is unchanged in both modes (\`test_VatCheck_BothModes_StaleOsmAboveMarketFreezes\`).

**What it risks weakening.** Once Multipli's OSM passes a manipulated price through, the Vat equals the attested price, so
the candidate rule can no longer freeze on "Vat above average" alone — it limits borrowing (WATCH) instead. During a sustained
manipulation the freeze must then come from the TWAP-deviation (≥ 15%) and velocity signals. Expected effect: shorter
PROTECTIVE periods in long pumps (A3, A4, X11). This is measured below, not assumed.

**How it was selected.** From the documented design intent above, after the baseline run showed that the rule caused most
restrictions in honest markets. It was not selected by searching over thresholds or rules against the test cases, and no
threshold value was changed. The holdout suite was written before the change and was not used to choose it; it is reported
for both rule sets so the effect on unseen scenarios is visible.

**How to reproduce.** \`npm run validate -- --rules=baseline\` (original rules, set explicitly) and
\`npm run validate -- --rules=candidate-graded\` (the alternative) each run on a fresh chain.

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
therefore the baseline rules (\`vatCheck = CONSERVATIVE\`, the contract default). The inconsistency that motivated the candidate
is fixed by documentation instead: the policy now states the rule explicitly — *the Vat must not lend more than 2% above the
conservative valuation min(market, 6 h average)* — rather than leaving it implicit. GRADED stays selectable only so this
comparison remains reproducible; it is not recommended.`;

/** Per-case analysis of every false positive and false negative, keyed by case id. */
export const ANALYSIS = {
  // ------------------------------------------------------------------ false positives (healthy, but restricted)
  H3: {
    why: "The rally moves the price 3%+ away from its 6 h TWAP within two hours (TWAP_DEVIATION_WATCH → WATCH). Two hours later the OSM passes the higher price to the Vat, which then lends more than 2% above min(attested, TWAP) = the lagging TWAP (VAT_ABOVE_EFFECTIVE → PROTECTIVE).",
    appropriate: "WATCH is defensible — a sustained 2%/h move is indistinguishable from a creeping manipulation at this point. The freeze applies the explicit conservative-valuation rule: the Vat lends above the 6 h average. Accepted as a cost.",
    mitigation: "The GRADED candidate limits instead of freezing here (evaluated, rejected because it weakens sustained-attack protection). A volatility-scaled TWAP band would reduce WATCH in genuine trends.",
  },
  H4: {
    why: "The +6% spike trips TWAP and velocity WATCH. When the price returns, the OSM still carries the spiked price for up to 2 hours, so the Vat lends 6% above the market (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING, then FRESH.",
    appropriate: "Partly. During the OSM lag the Vat genuinely overvalues collateral by 6%, so freezing new debt is the designed protection. The case returns to FRESH on its own — no permanent freeze.",
    mitigation: "Grade small overvaluation (e.g. 2–5% → WATCH, beyond → PROTECTIVE) instead of freezing at 2%, or account for the OSM's queued next price.",
  },
  H5: {
    why: "A +25% move in one hour exceeds the 20%/h velocity and 15% TWAP protect thresholds; once the OSM catches up, VAT_ABOVE_EFFECTIVE also holds.",
    appropriate: "By design. A genuine repricing of this size cannot be told apart from a pump using price data alone; freezing new debt while repayments stay open is the intended trade-off.",
    mitigation: "An independent signal (volume, multi-venue confirmation) would be needed to distinguish a real repricing — not available in this prototype.",
  },
  H6: {
    why: "A −10% move leaves Multipli's OSM (and so the Vat) 10% above the market for up to 2 hours: VAT_ABOVE_EFFECTIVE → PROTECTIVE, then RECOVERING, then WATCH (TWAP deviation).",
    appropriate: "Yes in substance: the Vat really lends 10% above the market during the lag — the stale-price exposure v1 was built to stop. Counted as a false positive only because the market itself is honest.",
    mitigation: "None proposed for the freeze; the residual WATCH could shorten with a trend-aware TWAP band.",
  },
  X1: {
    why: "A +1%/h rally is 3% above its 6 h TWAP after about 4 hours (TWAP_DEVIATION_WATCH).",
    appropriate: "Limited borrowing only, never frozen. Conservative for a slow honest trend.",
    mitigation: "The fixed 3% band is not volatility-aware; a band scaled to recent realised volatility would reduce this.",
  },
  X2: {
    why: "A +3%/h rally: TWAP WATCH from the first hour; after two OSM hops the Vat lends more than 2% above the lagging TWAP (VAT_ABOVE_EFFECTIVE → PROTECTIVE).",
    appropriate: "Same pattern as H3: a conservative-valuation freeze during a strong honest trend.",
    mitigation: "As H3. Under the rejected GRADED candidate this case is WATCH-only.",
  },
  X3: {
    why: "In a −1%/h decline the OSM's queued price keeps the Vat 2%+ above the market (VAT_ABOVE_EFFECTIVE → PROTECTIVE) for 5 of 6 hours.",
    appropriate: "The Vat does overvalue collateral by ~2%, so the rule works as written, but freezing for a slow honest decline is heavy-handed. This is the clearest cost of a fixed 2% tolerance against a 1–2 h lagged price.",
    mitigation: "Grade overvaluation (small → WATCH) or size the tolerance from the OSM delay and typical hourly volatility. Recorded as future work, deliberately not tuned against this suite.",
  },
  X4: {
    why: "A −4% step leaves the Vat 4% above the market during the OSM lag (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING, then FRESH.",
    appropriate: "Yes in substance (a real 4% overvaluation for up to 2 hours); returns to FRESH on its own.",
    mitigation: "As X3.",
  },
  X6: {
    why: "The +4% spike trips TWAP WATCH; after the price returns, the OSM still holds the spiked price (VAT_ABOVE_EFFECTIVE → PROTECTIVE), then RECOVERING.",
    appropriate: "As H4: a real, temporary overvaluation that clears itself.",
    mitigation: "As H4.",
  },
  // ------------------------------------------------------------------ false negatives (risk, but unrestricted)
  A4: {
    why: "Protected for 6 of 10 hours (TWAP protect, velocity, Vat above effective). Once $4,000 fills the 6 h window every deviation signal is zero, and with the deep-market depth assumption the cost gate reports LOW: RECOVERING, then FRESH while the manipulation continues.",
    appropriate: "Borrowing reopens at the manipulated price. Exposure is bounded — FRESH headroom never exceeds the epoch growth cap (100,000 rwaUSD per day) — but not prevented. Known Detection Boundary 1.",
    mitigation: "Longer or multi-window TWAPs, reopening in WATCH for a probation period, or an external liquidity signal instead of a static depth assumption.",
  },
  A6: {
    why: "+2.5% is below the 3% TWAP watch band and the 5%/h velocity band, and the cost gate finds nothing extractable below the 40% minimum profitable inflation.",
    appropriate: "Undetected by design. At a 140% liquidation ratio a 2.5% overvaluation cannot by itself create bad debt; it slightly increases borrowing capacity. Known Detection Boundary 2.",
    mitigation: "Tighter bands would catch it but raise false positives (see H3, X1); not changed.",
  },
  X11: {
    why: "As A4: protected for 6 of 8 hours, then the +45% price fills the TWAP window. With depth assumed at $2,000 per 1% the cost gate still reports LOW, because the Sentinel's bounded 50,000 headroom leaves little to extract, so borrowing reopens.",
    appropriate: "Bounded, not prevented: the cost gate behaves as designed (little is extractable within the capped headroom), but the manipulated price becomes the lending price.",
    mitigation: "As A4.",
  },
};
