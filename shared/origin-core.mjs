// Origin // ASO Sentinel — shared scenario engine (used by demo/run-origin.mjs and the app/ dashboard).
//
// This module holds NO risk logic: every decision comes from the deployed contracts. It only signs
// EIP-712 attestations with LOCAL TEST KEYS, sends real transactions, decodes revert reasons, and reads
// contract state. It refuses to send transactions on any chain other than local anvil (31337).
//
// Callers inject viem clients/accounts, so this file has no npm dependency of its own.

export const LOCAL_CHAIN_ID = 31337;

export const STATE = ["FRESH", "WATCH", "DISPUTED", "PROTECTIVE", "RECOVERING"];
export const VERIFIER_STATUS = ["NO_DATA", "OK", "STALE", "DISPUTED", "HALTED"];
export const CONCERN = ["LOW CONCERN", "ELEVATED", "HIGH CONCERN", "INSUFFICIENT DATA"];

/** Signal flags, mirrored from OriginSentinel.F_* (bit, severity, meaning). */
export const FLAGS = [
  { bit: 0, key: "ASO_HALTED", level: "protect", label: "Oracle halted", explain: "The verifier's guardian halted it (emergency stop)." },
  { bit: 1, key: "ASO_DISPUTED", level: "disputed", label: "Sources disagree", explain: "The latest signed round had a spread above the tolerance and was recorded as DISPUTED." },
  { bit: 2, key: "ASO_NO_DATA", level: "protect", label: "No accepted round", explain: "No signed round has been accepted yet." },
  { bit: 3, key: "ASO_STALE", level: "protect", label: "Attestations stale", explain: "The last accepted round is older than maxAge or past its expiry." },
  { bit: 4, key: "FEED_STALE", level: "protect", label: "Multipli feed stale", explain: "Multipli's PriceFeedAdapter reports its Chainlink-style feed as stale (or the call reverted)." },
  { bit: 5, key: "VAT_ABOVE_EFFECTIVE", level: "protect", label: "Vat price above effective price", explain: "The Vat lends at a price more than the tolerance above min(attested price, TWAP)." },
  { bit: 6, key: "TWAP_DEVIATION_PROTECT", level: "protect", label: "Far from TWAP", explain: "The attested price is beyond the protect threshold away from its time-weighted average." },
  { bit: 7, key: "VELOCITY_PROTECT", level: "protect", label: "Price moving too fast", explain: "Price change per hour between the last two accepted rounds is beyond the protect threshold." },
  { bit: 8, key: "COST_HIGH", level: "protect", label: "Manipulation looks cheap", explain: "Cost gate: estimated manipulation cost is below the estimated extractable value (HIGH CONCERN)." },
  { bit: 9, key: "TWAP_DEVIATION_WATCH", level: "watch", label: "Away from TWAP", explain: "The attested price is beyond the watch threshold away from its TWAP." },
  { bit: 10, key: "VELOCITY_WATCH", level: "watch", label: "Price moving quickly", explain: "Price change per hour is beyond the watch threshold." },
  { bit: 11, key: "COST_ELEVATED", level: "watch", label: "Manipulation cost elevated", explain: "Cost gate: cost is less than the elevated ratio times the extractable value." },
  { bit: 12, key: "COST_NO_DATA", level: "watch", label: "No depth assumption", explain: "The market-depth assumption is missing or older than its maximum age (INSUFFICIENT DATA)." },
  { bit: 13, key: "TWAP_INSUFFICIENT", level: "watch", label: "Not enough price history", explain: "The recorded history covers less of the TWAP window than required." },
  { bit: 14, key: "SOURCE_DIVERGENCE", level: "watch", label: "Weighted sources diverge", explain: "The weighted median of the recorded sources differs from the plain median beyond the threshold." },
];

export function decodeFlags(flags) {
  const f = Number(flags);
  return FLAGS.filter((d) => (f & (1 << d.bit)) !== 0);
}

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
export const HOUR = 3600n;
const ILK_TEXT = "PAXG-A";

export function usdToWad(usd) {
  // accepts number with up to 2 decimals, or bigint whole dollars
  if (typeof usd === "bigint") return usd * WAD;
  return BigInt(Math.round(usd * 100)) * (WAD / 100n);
}

/**
 * @param {object} p
 * @param {any} p.publicClient viem PublicClient
 * @param {any} p.testClient viem TestClient (mode "anvil")
 * @param {(acct:any)=>any} p.walletFor returns a viem WalletClient for an account
 * @param {object} p.deployment addresses (see script/DeployOrigin.s.sol)
 * @param {object} p.abis contract ABIs (shared/abis.json)
 * @param {object} p.accounts { admin, feeder, alice, bob, mallory, outsider, sources: Account[5] (ascending) }
 * @param {(rec:object)=>void} [p.onTx] called for every transaction record
 */
export function createOrigin({ publicClient, testClient, walletFor, deployment: D, abis: A, accounts: ACC, onTx = () => {} }) {
  const ILK = D.ilk;
  const keeper = ACC.admin; // anyone may relay rounds and poke; the admin account pays gas locally
  const records = [];

  async function assertLocal() {
    const id = await publicClient.getChainId();
    if (id !== LOCAL_CHAIN_ID) throw new Error(`Refusing to send transactions: connected to chain ${id}, expected local anvil ${LOCAL_CHAIN_ID}.`);
  }

  function decodeError(e) {
    const walk = (err) => {
      let cur = err;
      for (let i = 0; cur && i < 10; i++) {
        if (cur.name === "ContractFunctionRevertedError") return cur;
        cur = cur.cause;
      }
      return null;
    };
    const rev = walk(e);
    if (rev?.data?.errorName) return `${rev.data.errorName}(${(rev.data.args ?? []).map(String).join(", ")})`;
    return rev?.reason ?? e?.shortMessage ?? String(e?.message ?? e);
  }

  /** Real transaction. Expected reverts are MINED (fixed gas) so they exist on-chain with status reverted. */
  async function tx(label, account, address, abi, functionName, args = [], opt = {}) {
    await assertLocal();
    const expect = opt.expect ?? "success";
    let reason = null;
    try {
      await publicClient.simulateContract({ account, address, abi, functionName, args });
    } catch (e) {
      reason = decodeError(e);
    }
    const hash = await walletFor(account).writeContract({ address, abi, functionName, args, gas: 3_000_000n });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    const ok = rc.status === "success";
    const reasonOk = !opt.expectReason || (reason ?? "").includes(opt.expectReason);
    const pass = expect === "success" ? ok : !ok && reasonOk;
    const rec = {
      kind: "tx",
      network: "local-anvil",
      label,
      hash,
      block: Number(rc.blockNumber),
      status: ok ? "success" : "reverted",
      reason: ok ? null : reason,
      expect,
      expectReason: opt.expectReason ?? null,
      pass,
      check: opt.check ?? null,
      quiet: !!opt.quiet,
    };
    records.push(rec);
    onTx(rec);
    if (opt.strict && !pass) throw new Error(`UNEXPECTED: "${label}" expected ${expect}${opt.expectReason ? ` (${opt.expectReason})` : ""}, got ${rec.status}${reason ? ` (${reason})` : ""}`);
    return rec;
  }

  /** Non-transaction assertion on contract state, recorded like a tx. */
  function check(label, cond, actual, opt = {}) {
    const rec = { kind: "check", network: "local-anvil", label, pass: !!cond, actual: String(actual), check: opt.check ?? null };
    records.push(rec);
    onTx(rec);
    if (opt.strict && !cond) throw new Error(`UNEXPECTED: check "${label}" failed (actual: ${actual})`);
    return rec;
  }

  const read = (address, abi, functionName, args = [], account) =>
    publicClient.readContract({ address, abi, functionName, args, account });

  async function now() {
    return (await publicClient.getBlock()).timestamp;
  }

  async function warp(seconds) {
    await assertLocal();
    await testClient.increaseTime({ seconds: Number(seconds) });
    await testClient.mine({ blocks: 1 });
  }

  // ------------------------------------------------------------------ attestations
  const domain = { name: "ASO Verifier", version: "1", chainId: LOCAL_CHAIN_ID, verifyingContract: D.verifier };
  const types = {
    PriceAttestation: [
      { name: "profileId", type: "bytes32" },
      { name: "price", type: "uint256" },
      { name: "validAfter", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "source", type: "address" },
    ],
  };

  async function nextNonce() {
    return (await read(D.verifier, A.verifier, "lastNonce")) + 1n;
  }

  /** Sign a round. prices: USD numbers, one per source (first N sources, ascending). */
  async function signRound(prices, { nonce, signers = ACC.sources, validity } = {}) {
    const t = await now(); // block time, not the local clock
    const maxValidity = BigInt(D.maxValidity ?? 3600);
    const until = t + (validity ?? (maxValidity < HOUR ? maxValidity : HOUR));
    const n = nonce ?? (await nextNonce());
    const atts = [];
    const sigs = [];
    for (let i = 0; i < prices.length; i++) {
      const a = { profileId: D.profileId, price: usdToWad(prices[i]), validAfter: t, validUntil: until, nonce: n, source: signers[i].address };
      atts.push(a);
      sigs.push(await signers[i].signTypedData({ domain, types, primaryType: "PriceAttestation", message: a }));
    }
    return { atts, sigs, nonce: n };
  }

  /** Relay a round, record it in the risk engine's history, and (for 5 sources) record per-source data. */
  async function submitRound(prices, opt = {}) {
    const round = opt.round ?? (await signRound(prices, opt));
    const label = opt.label ?? `submitRound: ${prices.length} sources sign ${prices.map((p) => `$${p}`).join(" / ")}`;
    const rec = await tx(label, keeper, D.verifier, A.verifier, "submitRound", [round.atts, round.sigs], opt);
    if (rec.status === "success") {
      await tx("riskEngine.sync()", keeper, D.riskEngine, A.riskEngine, "sync", [], { quiet: true });
      if (opt.recordSources) {
        await tx("riskEngine.recordSources()", keeper, D.riskEngine, A.riskEngine, "recordSources", [round.atts, round.sigs], { quiet: true });
      }
    }
    return { rec, round };
  }

  const poke = (opt = {}) => tx(opt.label ?? "OriginSentinel.poke()", keeper, D.sentinel, A.sentinel, "poke", [], opt);

  async function setFeed(usd, opt = {}) {
    return tx(opt.label ?? `Feeder: MockAggregator.setAnswer($${usd})`, ACC.feeder, D.feed, A.feed, "setAnswer", [BigInt(Math.round(usd * 1e8))], { quiet: true, ...opt });
  }

  /** One OSM hop: +1 h, OSM.poke(), Spotter.poke() on both Vats. */
  async function osmHop() {
    await warp(HOUR);
    await tx("OSM.poke()", keeper, D.osm, A.osm, "poke", [], { quiet: true });
    await tx("Spotter.poke (baseline)", keeper, D.baselineSpotter, A.spot, "poke", [ILK], { quiet: true });
    await tx("Spotter.poke (protected)", keeper, D.protectedSpotter, A.spot, "poke", [ILK], { quiet: true });
  }

  const stackOf = (which) =>
    which === "baseline"
      ? { vat: D.baselineVat, join: D.baselineJoin, name: "BASELINE" }
      : { vat: D.protectedVat, join: D.protectedJoin, name: "PROTECTED" };

  async function deposit(who, whoName, which, usdTokens) {
    const s = stackOf(which);
    const wad = usdToWad(usdTokens);
    await tx(`${whoName}: approve mPAXG`, who, D.gem, A.gem, "approve", [s.join, wad], { quiet: true });
    await tx(`${whoName}: GemJoin5.join`, who, s.join, A.join, "join", [who.address, wad], { quiet: true });
    return tx(`${whoName}: deposit ${usdTokens} mPAXG in ${s.name} Vat`, who, s.vat, A.vat, "frob", [ILK, who.address, who.address, who.address, wad, 0n]);
  }

  const frobDebt = (who, whoName, which, amount, sign, opt) => {
    const s = stackOf(which);
    const wad = usdToWad(amount);
    const verb = sign > 0 ? "borrow" : "repay";
    return tx(opt.label ?? `${whoName}: ${verb} ${amount.toLocaleString("en-US")} rwaUSD on ${s.name} Vat`, who, s.vat, A.vat, "frob",
      [ILK, who.address, who.address, who.address, 0n, sign > 0 ? wad : -wad], opt);
  };
  const borrow = (who, whoName, which, amount, opt = {}) => frobDebt(who, whoName, which, amount, 1, opt);
  const repay = (who, whoName, which, amount, opt = {}) => frobDebt(who, whoName, which, amount, -1, opt);

  const setDepth = (usdPer1Pct, opt = {}) =>
    tx(opt.label ?? `Governance: riskEngine.setMarketDepth($${usdPer1Pct.toLocaleString("en-US")} per 1%) — assumption`, ACC.admin, D.riskEngine, A.riskEngine, "setMarketDepth", [usdToWad(usdPer1Pct)], opt);

  // ------------------------------------------------------------------ reads
  async function readSnapshot() {
    return read(D.sentinel, A.sentinel, "snapshot");
  }

  async function readState() {
    return Number(await read(D.sentinel, A.sentinel, "state"));
  }

  async function readAll() {
    const [snap, lim, thr, epoch, vStatus, vPrice, vLastNonce, vAccepted, observedAt, expiresAt, maxAge, quorum] = await Promise.all([
      readSnapshot(),
      read(D.sentinel, A.sentinel, "limits"),
      read(D.sentinel, A.sentinel, "thresholds"),
      read(D.sentinel, A.sentinel, "epochConfig"),
      read(D.verifier, A.verifier, "status"),
      read(D.verifier, A.verifier, "price"),
      read(D.verifier, A.verifier, "lastNonce"),
      read(D.verifier, A.verifier, "lastAcceptedNonce"),
      read(D.verifier, A.verifier, "observedAt"),
      read(D.verifier, A.verifier, "expiresAt"),
      read(D.verifier, A.verifier, "maxAge"),
      read(D.verifier, A.verifier, "quorum"),
    ]);
    const [depth, depthAt, maxDepthAge, twapWindow, minCoverage, wNonce, wPrice, stored, lossShare, elevatedRatio, highRatio] = await Promise.all([
      read(D.riskEngine, A.riskEngine, "depthUsdPer1Pct"),
      read(D.riskEngine, A.riskEngine, "depthUpdatedAt"),
      read(D.riskEngine, A.riskEngine, "maxDepthAge"),
      read(D.riskEngine, A.riskEngine, "twapWindow"),
      read(D.riskEngine, A.riskEngine, "minCoverageBps"),
      read(D.riskEngine, A.riskEngine, "weightedNonce"),
      read(D.riskEngine, A.riskEngine, "weightedMedianPrice"),
      read(D.riskEngine, A.riskEngine, "storedObservations"),
      read(D.riskEngine, A.riskEngine, "lossShareBps"),
      read(D.riskEngine, A.riskEngine, "elevatedRatioBps"),
      read(D.riskEngine, A.riskEngine, "highRatioBps"),
    ]);
    const nObs = Number(stored);
    const observations = await Promise.all(
      Array.from({ length: Math.min(nObs, 12) }, (_, i) => read(D.riskEngine, A.riskEngine, "observation", [BigInt(i)])),
    );
    const sources = await Promise.all(
      ACC.sources.map(async (s, i) => {
        const [weight, rep, isSigner] = await Promise.all([
          read(D.riskEngine, A.riskEngine, "sourceWeight", [s.address]),
          read(D.riskEngine, A.riskEngine, "lastReport", [s.address]),
          read(D.verifier, A.verifier, "isSigner", [s.address]),
        ]);
        return { index: i, address: s.address, weight: Number(weight), price: rep[0], validAfter: rep[1], nonce: rep[2], authorised: isSigner };
      }),
    );
    const [bIlk, pIlk, feedRound, adapterPeek, osmPeek, mat, blockTs, blockNumber] = await Promise.all([
      read(D.baselineVat, A.vat, "ilks", [ILK]),
      read(D.protectedVat, A.vat, "ilks", [ILK]),
      read(D.feed, A.feed, "latestRoundData"),
      read(D.adapter, A.adapter, "peek"),
      read(D.osm, A.osm, "peek", [], ACC.admin.address),
      read(D.protectedSpotter, A.spot, "ilks", [ILK]),
      now(),
      publicClient.getBlockNumber(),
    ]);
    const urns = {};
    for (const [name, acct] of [["alice", ACC.alice], ["bob", ACC.bob], ["mallory", ACC.mallory]]) {
      const [b, p] = await Promise.all([read(D.baselineVat, A.vat, "urns", [ILK, acct.address]), read(D.protectedVat, A.vat, "urns", [ILK, acct.address])]);
      urns[name] = { baseline: { ink: b[0], art: b[1] }, protected: { ink: p[0], art: p[1] } };
    }
    // Baseline cost-gate view: the same assumptions with the baseline's (unbounded) headroom.
    const bHeadroomWad = bIlk[3] > bIlk[0] * bIlk[1] ? (bIlk[3] - bIlk[0] * bIlk[1]) / RAY : 0n;
    const baselineQuote = await read(D.riskEngine, A.riskEngine, "quote", [depth, bHeadroomWad, mat[1], 10_000n]);
    return {
      snapshot: snap,
      limits: lim,
      thresholds: thr,
      epochConfig: epoch,
      verifier: { status: Number(vStatus), price: vPrice, lastNonce: vLastNonce, lastAcceptedNonce: vAccepted, observedAt, expiresAt, maxAge, quorum },
      risk: { depth, depthAt, maxDepthAge, twapWindow, minCoverage, weightedNonce: wNonce, weightedMedian: wPrice, storedObservations: nObs, observations, lossShare, elevatedRatio, highRatio },
      sources,
      baseline: { Art: bIlk[0], rate: bIlk[1], spot: bIlk[2], line: bIlk[3], dust: bIlk[4], debt: bIlk[0] * bIlk[1], headroomWad: bHeadroomWad, costBest: baselineQuote[2], concern: Number(baselineQuote[1]) },
      protectedVat: { Art: pIlk[0], rate: pIlk[1], spot: pIlk[2], line: pIlk[3], dust: pIlk[4], debt: pIlk[0] * pIlk[1] },
      feed: { answer: feedRound[1], updatedAt: feedRound[3] },
      adapterValid: adapterPeek[1],
      osm: { value: BigInt(osmPeek[0]), has: osmPeek[1] },
      matRay: mat[1],
      urns,
      chain: { timestamp: blockTs, block: blockNumber },
    };
  }

  async function quote(depthUsd, headroomUsd, deviationBps) {
    const mat = (await read(D.protectedSpotter, A.spot, "ilks", [ILK]))[1];
    const [q, concern, best] = await read(D.riskEngine, A.riskEngine, "quote", [usdToWad(depthUsd), usdToWad(headroomUsd), mat, BigInt(deviationBps)]);
    return { quote: q, concern: Number(concern), best, matRay: mat };
  }

  // ------------------------------------------------------------------ bootstrap and scenarios

  /** From a fresh deployment to a healthy, borrowed-in state. Deterministic. */
  async function bootstrap() {
    await tx("OSM.poke()", keeper, D.osm, A.osm, "poke", [], { quiet: true });
    await osmHop(); // OSM serves $2,500 to both Vats
    await submitRound([2500, 2500, 2500], { label: "Round: 3-of-5 sources sign $2,500", strict: true });
    await warp(3n * HOUR);
    await setFeed(2500);
    await submitRound([2500, 2500, 2500], { label: "Round: $2,500 (3 h of history for the TWAP)", strict: true });
    await poke({ label: "poke() → RECOVERING (healthy, waiting for delay + new round)", strict: true });
    check("Sentinel is RECOVERING, not FRESH", (await readState()) === 4, STATE[await readState()], { strict: true });
    await warp(HOUR);
    await submitRound([2500, 2500, 2500, 2500, 2500], { label: "Round: all 5 sources sign $2,500", recordSources: true, strict: true });
    await poke({ label: "poke() → FRESH", strict: true });
    check("Sentinel is FRESH", (await readState()) === 0, STATE[await readState()], { strict: true });
    for (const which of ["baseline", "protected"]) await deposit(ACC.alice, "Alice", which, 100);
    await borrow(ACC.alice, "Alice", "baseline", 50_000, { strict: true });
    await borrow(ACC.alice, "Alice", "protected", 50_000, { strict: true });
    await deposit(ACC.bob, "Bob", "protected", 20);
  }

  /** Keep every source fresh at the current block time (feed + agreeing round). */
  async function freshAt(usd, label) {
    await setFeed(usd);
    return submitRound([usd, usd, usd, usd, usd], { label: label ?? `Round: all 5 sources sign $${usd}`, recordSources: true });
  }

  return {
    D, A, ACC, records,
    tx, check, read, now, warp, nextNonce, signRound, submitRound, poke, setFeed, osmHop,
    deposit, borrow, repay, setDepth, readAll, readSnapshot, readState, quote, bootstrap, freshAt, decodeError, assertLocal,
  };
}

// ====================================================================== scenarios
// Each step: { title, say, run(o) } — `say` is the plain-language explanation for judges.
// Every step performs real transactions through `o` and relies on contract state for outcomes.

export const SCENARIOS = [
  {
    id: "attacks",
    title: "Attacks on the price data",
    summary: "Forged signature, outsider signer, duplicated source, replayed round: all rejected by ASOVerifier on-chain.",
    steps: [
      {
        title: "Forged price under a real source's signature",
        say: "A relayer edits a signed price. The EIP-712 signature no longer matches, so the round reverts.",
        run: async (o) => {
          const r = await o.signRound([2500, 2500, 2500]);
          r.atts[1] = { ...r.atts[1], price: usdToWad(9999) };
          await o.submitRound([2500, 2500, 2500], { round: r, label: "Forged price ($9,999) under source #2's signature", expect: "revert", expectReason: "InvalidSignature" });
        },
      },
      {
        title: "Signer outside the authorised set",
        say: "A valid signature from a key that is not one of the five sources is refused.",
        run: async (o) => {
          const signers = [o.ACC.sources[0], o.ACC.sources[1], o.ACC.outsider].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
          const r = await o.signRound([2500, 2500, 2500], { signers });
          await o.submitRound([2500, 2500, 2500], { round: r, label: "Round including an outsider key", expect: "revert", expectReason: "UnauthorizedSigner" });
        },
      },
      {
        title: "Same source counted twice",
        say: "Sources must be strictly ascending by address, so one source cannot fake a 3-of-5 quorum.",
        run: async (o) => {
          const r = await o.signRound([2500, 2500, 2500]);
          r.atts[2] = r.atts[1];
          r.sigs[2] = r.sigs[1];
          await o.submitRound([2500, 2500, 2500], { round: r, label: "Source #2 counted twice", expect: "revert", expectReason: "SignersNotStrictlyAscending" });
        },
      },
      {
        title: "Replay of an accepted round",
        say: "Round numbers must strictly increase: re-sending an accepted round reverts.",
        run: async (o) => {
          const { round } = await o.submitRound([2500, 2500, 2500], { label: "Valid round (to be replayed)" });
          await o.submitRound([2500, 2500, 2500], { round, label: "REPLAY of that round", expect: "revert", expectReason: "NonceNotIncreasing" });
        },
      },
    ],
  },
  {
    id: "A",
    title: "A. Thin-market pump",
    summary: "Every source honestly reports a manipulated +60% price. The quorum is satisfied; the baseline lends against it; the protected market does not.",
    steps: [
      {
        title: "Governance assumption: thin market",
        say: "We assume $1,000 moves this market 1%. This is an ASSUMPTION the cost gate uses, not measured liquidity.",
        run: async (o) => { await o.setDepth(1_000); await o.poke({ label: "poke() with the thin-market assumption" }); },
      },
      {
        title: "Pump: feed and all five sources read $4,000",
        say: "The price is manipulated upward. All sources agree, so the verifier says OK — quorum alone cannot catch this.",
        run: async (o) => {
          await o.warp(HOUR);
          await o.freshAt(4000, "Round: all 5 sources honestly sign $4,000 (+60%)");
          await o.poke({ label: "poke() → PROTECTIVE (far from TWAP, moving 60%/h)" });
        },
      },
      {
        title: "Multipli's OSM passes the pumped price through",
        say: "Two OSM hops later, both Vats lend at $4,000.",
        run: async (o) => { for (let i = 0; i < 2; i++) { await o.osmHop(); await o.freshAt(4000); } await o.poke(); },
      },
      {
        title: "Attacker borrows on both markets",
        say: "Baseline: 100 mPAXG at $4,000 / 1.4 lets Mallory borrow 285k. Protected: the ceiling is zero, the borrow reverts.",
        run: async (o) => {
          for (const w of ["baseline", "protected"]) await o.deposit(o.ACC.mallory, "Mallory", w, 100);
          await o.borrow(o.ACC.mallory, "Mallory", "baseline", 285_000);
          await o.borrow(o.ACC.mallory, "Mallory", "protected", 1_000, { expect: "revert", expectReason: "Vat/ceiling-exceeded" });
        },
      },
    ],
  },
  {
    id: "B",
    title: "B. Sustained squeeze",
    summary: "A manipulation held longer than the 6 h TWAP window becomes the TWAP. The Sentinel delays it; the epoch cap bounds what can be extracted.",
    steps: [
      {
        title: "Pump and hold at $4,000",
        say: "Thin-market assumption, price held at $4,000.",
        run: async (o) => { await o.setDepth(1_000); await o.warp(HOUR); await o.freshAt(4000); await o.poke(); },
      },
      {
        title: "Hold for 8 hours (hourly rounds)",
        say: "After the window is full of $4,000, deviation and velocity signals fade. This is a real limit of TWAP-based detection.",
        run: async (o) => { for (let i = 0; i < 8; i++) { await o.osmHop(); await o.freshAt(4000); await o.poke(); } },
      },
      {
        title: "Borrowing reopens — only within the bounded headroom",
        say: "WATCH (cost concern) opens 25% of the gap, and the epoch cap limits net growth per day.",
        run: async (o) => { await o.warp(HOUR); await o.freshAt(4000); await o.poke(); await o.warp(HOUR); await o.freshAt(4000); await o.poke(); },
      },
    ],
  },
  {
    id: "C",
    title: "C. Honest gradual movement",
    summary: "+0.5% per hour for 6 hours with the feed following: stays FRESH, borrowing continues.",
    steps: [
      {
        title: "Six hours of gradual rise",
        say: "Gradual, consistent movement is not treated as manipulation.",
        run: async (o) => {
          let p = 2500;
          for (let i = 0; i < 6; i++) { p = Math.round(p * 1.005 * 100) / 100; await o.warp(HOUR); await o.freshAt(p); await o.poke({ label: `poke() at $${p}` }); }
        },
      },
      {
        title: "Borrowing still works",
        say: "Bob borrows on the protected market.",
        run: async (o) => { await o.borrow(o.ACC.bob, "Bob", "protected", 5_000); },
      },
    ],
  },
  {
    id: "D",
    title: "D. Stale oracle",
    summary: "The market falls to $1,500 but the Chainlink-style feed freezes; Multipli's OSM keeps $2,500. The protected market restricts.",
    steps: [
      {
        title: "Sources see the real price, the feed does not",
        say: "Attested $1,500 while the Vat still lends at $2,500.",
        run: async (o) => {
          await o.warp(600n);
          await o.submitRound([1500, 1500, 1500, 1500, 1500], { label: "Round: all 5 sources sign $1,500 (feed frozen at $2,500)", recordSources: true });
          await o.poke({ label: "poke() → PROTECTIVE (Vat price above effective price)" });
        },
      },
      {
        title: "Baseline over-lends, protected blocks",
        say: "Baseline: 178k against $150k of real collateral. Protected: reverts.",
        run: async (o) => {
          for (const w of ["baseline", "protected"]) await o.deposit(o.ACC.mallory, "Mallory", w, 100);
          await o.borrow(o.ACC.mallory, "Mallory", "baseline", 178_000);
          await o.borrow(o.ACC.mallory, "Mallory", "protected", 1_000, { expect: "revert", expectReason: "Vat/ceiling-exceeded" });
        },
      },
    ],
  },
  {
    id: "E",
    title: "E. Conflicting sources",
    summary: "Sources disagree beyond 1%: DISPUTED. Borrowing stops, repayment works, recovery needs a new round and a delay.",
    steps: [
      {
        title: "Sources disagree",
        say: "Round $1,500 / $2,500 / $2,510 is recorded as DISPUTED, not silently dropped.",
        run: async (o) => { await o.submitRound([1500, 2500, 2510], { label: "Round: sources disagree (1500 / 2500 / 2510)" }); await o.poke({ label: "poke() → DISPUTED" }); },
      },
      {
        title: "Borrow blocked, repayment works",
        say: "The Vat itself rejects new debt; repaying skips the ceiling check.",
        run: async (o) => {
          await o.borrow(o.ACC.bob, "Bob", "protected", 1_000, { expect: "revert", expectReason: "Vat/ceiling-exceeded" });
          await o.repay(o.ACC.alice, "Alice", "protected", 10_000);
        },
      },
      {
        title: "Recovery: new round, then the delay",
        say: "Agreeing data moves the state to RECOVERING, never straight to FRESH. After the delay and a newer round, borrowing reopens.",
        run: async (o) => {
          await o.warp(60n);
          await o.freshAt(2500);
          await o.poke({ label: "poke() → RECOVERING" });
          await o.warp(HOUR);
          await o.freshAt(2500);
          await o.poke({ label: "poke() → FRESH (new round + delay)" });
          await o.borrow(o.ACC.bob, "Bob", "protected", 1_000);
        },
      },
    ],
  },
];

/** Guided judge sequence (Presentation mode). */
export const PRESENTATION = [
  { title: "1. Healthy system", say: "Five independent sources sign prices; three that agree make a round. The Sentinel is FRESH and Alice has borrowed on both markets.", run: async () => {} },
  { title: "2. Oracle disagreement", say: "Sources disagree beyond 1%. The round is recorded as DISPUTED and the Sentinel closes the debt ceiling.", run: async (o) => { await o.submitRound([1500, 2500, 2510], { label: "Round: sources disagree" }); await o.poke({ label: "poke() → DISPUTED" }); } },
  { title: "3. Manipulation-cost warning", say: "Sources agree again, but governance's depth assumption says the market is thin: the cost gate raises a concern.", run: async (o) => { await o.warp(60n); await o.freshAt(2500); await o.setDepth(1_000); await o.poke({ label: "poke() → RECOVERING (cost ELEVATED)" }); } },
  { title: "4. Protective restriction", say: "A +60% pump hits every source at once. The TWAP and velocity checks put the market into PROTECTIVE: new debt is blocked.", run: async (o) => { await o.warp(HOUR); await o.freshAt(4000, "Round: all sources sign a pumped $4,000"); await o.poke({ label: "poke() → PROTECTIVE" }); await o.borrow(o.ACC.bob, "Bob", "protected", 1_000, { expect: "revert", expectReason: "Vat/ceiling-exceeded" }); } },
  { title: "5. Repayment", say: "Repayment still works while restricted: the Vat skips the ceiling check when debt goes down.", run: async (o) => { await o.repay(o.ACC.alice, "Alice", "protected", 10_000); } },
  {
    title: "6. Fresh accepted round",
    say: "The market returns to $2,500 and fresh agreeing rounds arrive hourly until the risk signals clear. The state moves to RECOVERING — never straight to FRESH.",
    run: async (o) => {
      await o.setDepth(250_000);
      for (let i = 0; i < 10; i++) {
        await o.warp(HOUR);
        await o.freshAt(2500);
        await o.poke();
        if ((await o.readState()) === 4) return; // RECOVERING reached; recovery itself is step 7
      }
      throw new Error("signals did not clear within 10 hours");
    },
  },
  { title: "7. Recovery", say: "After the recovery delay and a newer round, borrowing reopens. While the 6 h TWAP still remembers the pump the Sentinel sits in WATCH with reduced headroom; it returns to FRESH once the window rolls past it.", run: async (o) => { await o.warp(HOUR); await o.freshAt(2500); await o.poke({ label: "poke() → open again" }); await o.borrow(o.ACC.bob, "Bob", "protected", 1_000); } },
];
