// Origin // ASO Sentinel — validation suite.
//
// A labelled test matrix run against the REAL contracts on a local anvil chain. Every case starts from the
// same healthy snapshot, performs real transactions, and after every poke() records what the Sentinel did:
// state, flags, debt ceiling, and whether a borrow / a repayment WOULD succeed (eth_call probes, nothing mined).
//
// Ground truth is fixed per case BEFORE running; results are never tuned to it:
//   risk      an attack or oracle failure is present   → Sentinel must restrict (or the verifier must reject)
//   healthy   honest market, honest sources            → Sentinel should NOT restrict
//   degraded  sources partly unavailable               → compared with the documented degraded policy
//
// Classification (risk / healthy cases only):
//   TP  risk, required protection reached, and not lapsed back to unrestricted while the risk persists
//   FN  risk, protection never reached, or borrowing was unrestricted again while the risk persisted
//   TN  healthy, never restricted
//   FP  healthy, restricted at any point (WATCH counts as a restriction: it limits borrowing)
//
// Pure ESM with no npm dependency: used by demo/run-validation.mjs (Node) and the dashboard (browser).

import { STATE, decodeFlags, HOUR } from "./origin-core.mjs";

const RESTRICTED = new Set([2, 3, 4]);
export const POLICY_TEXT = ["normal", "limited", "blocked", "blocked", "blocked"];

// ---------------------------------------------------------------------------------------------- cases

/** @typedef {{ id: string, group: string, truth: 'risk'|'healthy'|'degraded', title: string, description: string,
 *   required: 'reject'|'blocked'|'limited'|'none', expected: string, expectedState?: string, trigger: string,
 *   sources: { online: number, manipulated: number, note?: string }, run: (o: any, c: any) => Promise<void> }} Case */

const honestAll = (usd) => [usd, usd, usd, usd, usd];

/** @type {Case[]} */
export const CASES = [
  // ------------------------------------------------------------------------------------------ healthy
  {
    id: "H1", group: "Healthy market", truth: "healthy", title: "Healthy baseline",
    description: "Five sources sign $2,500 every hour for 3 hours; feed and OSM follow.",
    required: "none", expected: "Stays FRESH, normal borrowing", expectedState: "FRESH", trigger: "none",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { for (let i = 0; i < 3; i++) { await c.hour(); await c.round(honestAll(2500)); await c.poke("hourly poke"); } },
  },
  {
    id: "H2", group: "Healthy market", truth: "healthy", title: "Honest gradual movement (+0.5%/h)",
    description: "The market rises 0.5% per hour for 8 hours; every source and the feed follow.",
    required: "none", expected: "Stays FRESH", expectedState: "FRESH", trigger: "+0.5%/h for 8 h",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { let p = 2500; for (let i = 0; i < 8; i++) { p = r2(p * 1.005); await c.hour(); await c.round(honestAll(p)); await c.poke(`$${p}`); } },
  },
  {
    id: "H3", group: "Healthy market", truth: "healthy", title: "Legitimate strong rally (+2%/h)",
    description: "A real, sustained rally of 2% per hour for 6 hours; sources and feed report it honestly.",
    required: "none", expected: "Ideally FRESH; may trip the 3% TWAP-watch band", expectedState: "FRESH", trigger: "+2%/h for 6 h",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { let p = 2500; for (let i = 0; i < 6; i++) { p = r2(p * 1.02); await c.hour(); await c.round(honestAll(p)); await c.poke(`$${p}`); } },
  },
  {
    id: "H4", group: "Healthy market", truth: "healthy", title: "Temporary volatility (+6% spike, then back)",
    description: "One hour at +6%, then the price returns to $2,500 and stays there for 3 hours.",
    required: "none", expected: "Brief WATCH at most; must not freeze permanently", expectedState: "FRESH", trigger: "+6% for 1 h",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => {
      await c.hour(); await c.round(honestAll(2650)); await c.poke("spike +6%");
      for (let i = 0; i < 4; i++) { await c.hour(); await c.round(honestAll(2500)); await c.poke("back to $2,500"); }
    },
  },
  {
    id: "H5", group: "Healthy market", truth: "healthy", title: "Extreme but legitimate move (+25% in 1 h)",
    description: "A genuine repricing: +25% within an hour, then held for 3 hours. Nothing is manipulated.",
    required: "none", expected: "Policy restricts anyway (velocity ≥ 20%/h): a known false positive", expectedState: "FRESH", trigger: "+25% in 1 h",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { await c.hour(); await c.round(honestAll(3125)); await c.poke("+25%"); for (let i = 0; i < 3; i++) { await c.hour(); await c.round(honestAll(3125)); await c.poke("hold"); } },
  },
  {
    id: "H6", group: "Healthy market", truth: "healthy", title: "Legitimate decline (−10% in 1 h)",
    description: "A genuine −10% move. Multipli's OSM delays prices by 1 h, so the Vat briefly lends above the market.",
    required: "none", expected: "Likely PROTECTIVE while the OSM lags (Vat above effective price)", expectedState: "FRESH", trigger: "−10% in 1 h",
    sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { await c.hour(); await c.round(honestAll(2250)); await c.poke("−10%"); for (let i = 0; i < 3; i++) { await c.hour(); await c.round(honestAll(2250)); await c.poke("hold"); } },
  },

  // ------------------------------------------------------------------------------------------ market manipulation
  {
    id: "A1", group: "Market manipulation", truth: "risk", title: "Thin-market pump, all sources honestly report it",
    description: "Governance assumes a thin market ($1,000 moves the price 1%). The market is pumped +60%; all five sources and the feed report $4,000; the OSM passes it through.",
    required: "blocked", expected: "PROTECTIVE (TWAP, velocity, cost gate)", expectedState: "PROTECTIVE", trigger: "+60% manipulated market",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => {
      await c.setDepth(1_000); await c.poke("thin-market assumption");
      await c.hour(); c.onset("pumped round"); await c.round(honestAll(4000)); await c.poke("pump observed");
      for (let i = 0; i < 2; i++) { await c.hour(); await c.round(honestAll(4000)); await c.poke("OSM passes $4,000 through"); }
    },
  },
  {
    id: "A2", group: "Market manipulation", truth: "risk", title: "Sudden large movement (+30% in one round)",
    description: "A +30% jump reported by every source, then held for 2 hours (default deep-market assumption).",
    required: "blocked", expected: "PROTECTIVE (velocity ≥ 20%/h, TWAP ≥ 15%)", expectedState: "PROTECTIVE", trigger: "+30% jump",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => { await c.hour(); c.onset("jump"); await c.round(honestAll(3250)); await c.poke("jump"); for (let i = 0; i < 2; i++) { await c.hour(); await c.round(honestAll(3250)); await c.poke("hold"); } },
  },
  {
    id: "A3", group: "Market manipulation", truth: "risk", title: "Sustained manipulation, thin-market assumption",
    description: "Price pumped to $4,000 and held for 9 hours — longer than the 6 h TWAP window. Depth assumption: thin.",
    required: "limited", expected: "PROTECTIVE, then at best WATCH (cost gate) once the TWAP catches up", expectedState: "WATCH", trigger: "+60% held 9 h",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => { await c.setDepth(1_000); await c.hour(); c.onset("pump"); await c.round(honestAll(4000)); await c.poke("pump"); for (let i = 0; i < 9; i++) { await c.hour(); await c.round(honestAll(4000)); await c.poke("hold"); } },
  },
  {
    id: "A4", group: "Market manipulation", truth: "risk", title: "Sustained manipulation, deep-market assumption",
    description: "Same 9-hour hold, but governance's depth assumption says the market is deep ($250k per 1%). Once the TWAP absorbs the pump nothing flags it.",
    required: "limited", expected: "Known limit: may return to FRESH after the TWAP window", expectedState: "PROTECTIVE", trigger: "+60% held 9 h",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => { await c.hour(); c.onset("pump"); await c.round(honestAll(4000)); await c.poke("pump"); for (let i = 0; i < 9; i++) { await c.hour(); await c.round(honestAll(4000)); await c.poke("hold"); } },
  },
  {
    id: "A5", group: "Market manipulation", truth: "risk", title: "Creeping manipulation (+10%/h for 6 h)",
    description: "The price is walked up 10% per hour (+77% in total) instead of one jump.",
    required: "limited", expected: "At least WATCH (velocity ≥ 5%/h), PROTECTIVE once far from TWAP", expectedState: "PROTECTIVE", trigger: "+10%/h × 6",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => { let p = 2500; for (let i = 0; i < 6; i++) { p = r2(p * 1.1); await c.hour(); if (i === 0) c.onset("first step"); await c.round(honestAll(p)); await c.poke(`$${p}`); } },
  },
  {
    id: "A6", group: "Market manipulation", truth: "risk", title: "Sub-threshold manipulation (+2.5%)",
    description: "A small +2.5% manipulation reported by all sources. Below every watch threshold — and, at a 140% liquidation ratio, not profitable (needs > +40%).",
    required: "limited", expected: "Not detected: below the 3% / 5%/h thresholds (detection floor)", expectedState: "FRESH", trigger: "+2.5%",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => { await c.hour(); c.onset("manipulated round"); await c.round(honestAll(2562.5)); await c.poke("+2.5%"); await c.hour(); await c.round(honestAll(2562.5)); await c.poke("hold"); },
  },

  // ------------------------------------------------------------------------------------------ coordinated sources
  ...[1, 2, 3, 4].map((k) => ({
    id: `M${k}`, group: "Coordinated sources", truth: "risk", title: `${k} of 5 sources manipulated (all signatures relayed)`,
    description: `${k} source${k > 1 ? "s" : ""} sign $4,000 while the rest sign the real $2,500; the relayer submits all five signatures.`,
    required: "blocked", expected: "DISPUTED (spread > 1%)", expectedState: "DISPUTED", trigger: `${k}/5 sources lie (+60%)`,
    sources: { online: 5, manipulated: k },
    run: async (o, c) => {
      await c.wait(600); c.onset("mixed round");
      await c.round([0, 1, 2, 3, 4].map((i) => (i < k ? 4000 : 2500)), { feed: false, record: false });
      await c.poke("mixed round");
    },
  })),
  ...[3, 4, 5].map((k) => ({
    id: `V${k}`, group: "Coordinated sources", truth: "risk", title: `${k} of 5 sources collude, only their signatures relayed`,
    description: `A colluding ${k === 5 ? "set of all five" : "majority"} signs $4,000 and a malicious relayer submits only those ${k} signatures. The round is cryptographically VALID; the real market (feed) is still $2,500.`,
    required: "blocked", expected: "Verifier accepts; risk engine → PROTECTIVE", expectedState: "PROTECTIVE", trigger: `valid ${k}-of-5 round at +60%`,
    sources: { online: 5, manipulated: k, note: "valid signatures, false price" },
    run: async (o, c) => {
      await c.wait(600); c.onset("colluding round");
      const rec = await c.round(Array(k).fill(4000), { signers: k, feed: false });
      c.assert("verifier accepted the colluding round (cryptographically valid)", rec.status === "success", rec.status);
      await c.poke("colluding round");
    },
  })),

  // ------------------------------------------------------------------------------------------ oracle failures
  {
    id: "F1", group: "Oracle failure", truth: "risk", title: "Stale upstream price while the market falls",
    description: "The market falls to $1,500. Sources report it, but the Chainlink-style feed freezes and Multipli's OSM keeps $2,500.",
    required: "blocked", expected: "PROTECTIVE (Vat price above effective price)", expectedState: "PROTECTIVE", trigger: "feed frozen, market −40%",
    sources: { online: 5, manipulated: 0, note: "feed stale" },
    run: async (o, c) => { await c.wait(600); c.onset("real price diverges from frozen feed"); await c.round(honestAll(1500), { feed: false }); await c.poke("sources $1,500, Vat $2,500"); },
  },
  {
    id: "F2", group: "Oracle failure", truth: "risk", title: "Upstream feed frozen for 25 hours",
    description: "Sources keep signing a stable $2,500, but the Chainlink-style feed stops updating. Multipli's adapter flags it after its 24 h maxDelay.",
    required: "blocked", expected: "PROTECTIVE once the adapter reports stale (24 h)", expectedState: "PROTECTIVE", trigger: "feed frozen",
    sources: { online: 5, manipulated: 0, note: "feed stale" },
    run: async (o, c) => {
      const t0 = Number((await o.read(o.D.feed, o.A.feed, "latestRoundData"))[3]);
      c.onset("feed stops updating", t0);
      for (let i = 0; i < 25; i++) { await c.hour(); await c.round(honestAll(2500), { feed: false, quiet: true }); await c.poke(`hour ${i + 1}`); }
    },
  },
  {
    id: "F3", group: "Oracle failure", truth: "risk", title: "Conflicting sources (1500 / 2500 / 2510)",
    description: "Three sources disagree by far more than 1%.",
    required: "blocked", expected: "DISPUTED", expectedState: "DISPUTED", trigger: "spread 67%",
    sources: { online: 3, manipulated: 1, note: "one faulty source" },
    run: async (o, c) => { await c.wait(600); c.onset("conflicting round"); await c.round([1500, 2500, 2510], { signers: 3, feed: false, record: false }); await c.poke("conflict"); },
  },

  // ------------------------------------------------------------------------------------------ invalid data (verifier)
  {
    id: "I1", group: "Invalid data", truth: "risk", title: "Forged price under a real signature", description: "A relayer edits a signed price to $9,999.",
    required: "reject", expected: "Verifier reverts InvalidSignature", trigger: "tampered attestation", sources: { online: 5, manipulated: 1, note: "tampered in transit" },
    run: async (o, c) => { await c.wait(300); c.onset("forged round"); const r = await o.signRound([2500, 2500, 2500]); r.atts[1] = { ...r.atts[1], price: 9999n * 10n ** 18n }; await c.reject("forged round", r, "InvalidSignature"); await c.poke("after rejection"); },
  },
  {
    id: "I2", group: "Invalid data", truth: "risk", title: "Unauthorised signer", description: "A valid signature from a key outside the five sources.",
    required: "reject", expected: "Verifier reverts UnauthorizedSigner", trigger: "outsider key", sources: { online: 5, manipulated: 1, note: "outsider" },
    run: async (o, c) => {
      await c.wait(300); c.onset("outsider round");
      const signers = [o.ACC.sources[0], o.ACC.sources[1], o.ACC.outsider].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
      await c.reject("outsider round", await o.signRound([2500, 2500, 2500], { signers }), "UnauthorizedSigner"); await c.poke("after rejection");
    },
  },
  {
    id: "I3", group: "Invalid data", truth: "risk", title: "Replay of an accepted round", description: "An accepted round is re-submitted later.",
    required: "reject", expected: "Verifier reverts NonceNotIncreasing", trigger: "replay", sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { await c.wait(300); const { round } = await o.submitRound([2500, 2500, 2500], { label: "valid round (later replayed)" }); await c.wait(1200); c.onset("replay"); await c.reject("replayed round", round, "NonceNotIncreasing"); await c.poke("after rejection"); },
  },
  {
    id: "I4", group: "Invalid data", truth: "risk", title: "Stale nonce (fresh signatures, old round number)", description: "Newly signed attestations reuse the last round number.",
    required: "reject", expected: "Verifier reverts NonceNotIncreasing", trigger: "nonce reuse", sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { await c.wait(300); c.onset("old-nonce round"); const last = await o.read(o.D.verifier, o.A.verifier, "lastNonce"); await c.reject("old-nonce round", await o.signRound([2600, 2600, 2600], { nonce: last }), "NonceNotIncreasing"); await c.poke("after rejection"); },
  },
  {
    id: "I5", group: "Invalid data", truth: "risk", title: "One source counted twice", description: "A relayer duplicates one signature to fake a 3-of-5 quorum.",
    required: "reject", expected: "Verifier reverts SignersNotStrictlyAscending", trigger: "duplicate signer", sources: { online: 2, manipulated: 0 },
    run: async (o, c) => { await c.wait(300); c.onset("duplicated signer"); const r = await o.signRound([2500, 2500, 2500]); r.atts[2] = r.atts[1]; r.sigs[2] = r.sigs[1]; await c.reject("duplicated signer", r, "SignersNotStrictlyAscending"); await c.poke("after rejection"); },
  },
  {
    id: "I6", group: "Invalid data", truth: "risk", title: "Insufficient quorum (2 signatures)", description: "Only two sources sign the round.",
    required: "reject", expected: "Verifier reverts QuorumNotMet", trigger: "2 of 3 required", sources: { online: 2, manipulated: 0 },
    run: async (o, c) => { await c.wait(300); c.onset("2-signature round"); await c.reject("2-signature round", await o.signRound([2500, 2500]), "QuorumNotMet"); await c.poke("after rejection"); },
  },
  {
    id: "I7", group: "Invalid data", truth: "risk", title: "Expired attestation", description: "A round valid for 60 s is submitted 2 minutes later.",
    required: "reject", expected: "Verifier reverts Expired", trigger: "expired", sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { await c.wait(300); c.onset("expired round"); const r = await o.signRound([2500, 2500, 2500], { validity: 60n }); await c.wait(120); await c.reject("expired round", r, "Expired"); await c.poke("after rejection"); },
  },

  // ------------------------------------------------------------------------------------------ availability
  {
    id: "S5", group: "Source availability", truth: "healthy", title: "5 of 5 sources online", description: "All sources sign every hour.",
    required: "none", expected: "FRESH", expectedState: "FRESH", trigger: "none", sources: { online: 5, manipulated: 0 },
    run: async (o, c) => { for (let i = 0; i < 2; i++) { await c.hour(); await c.round(honestAll(2500)); await c.poke("5 sources"); } },
  },
  {
    id: "S4", group: "Source availability", truth: "healthy", title: "4 of 5 sources online", description: "One source offline; four sign every hour (one spare above quorum).",
    required: "none", expected: "FRESH (redundancy remains)", expectedState: "FRESH", trigger: "1 source offline", sources: { online: 4, manipulated: 0 },
    run: async (o, c) => { for (let i = 0; i < 2; i++) { await c.hour(); await c.round([2500, 2500, 2500, 2500], { signers: 4 }); await c.poke("4 sources"); } },
  },
  {
    id: "S3", group: "Source availability", truth: "degraded", title: "3 of 5 sources online (minimum quorum)", description: "Two sources offline; exactly the quorum signs every hour.",
    required: "limited", expected: "WATCH: borrowing limited (no redundancy left)", expectedState: "WATCH", trigger: "2 sources offline", sources: { online: 3, manipulated: 0 },
    run: async (o, c) => { c.onset("2 sources offline"); for (let i = 0; i < 2; i++) { await c.hour(); await c.round([2500, 2500, 2500], { signers: 3 }); await c.poke("3 sources"); } },
  },
  ...[2, 1, 0].map((k) => ({
    id: `S${k}`, group: "Source availability", truth: "risk", title: `${k} of 5 sources online (quorum impossible)`,
    description: `${5 - k} sources offline: no new round can reach the 3-of-5 quorum. The last accepted round ages out after maxAge (1 h). Polled every 10 minutes.`,
    required: "blocked", expected: "PROTECTIVE once the last round is stale", expectedState: "PROTECTIVE", trigger: `${5 - k} sources offline`,
    sources: { online: k, manipulated: 0 },
    run: async (o, c) => {
      c.onset("outage begins");
      if (k > 0) await c.reject(`${k}-signature round`, await o.signRound(Array(k).fill(2500)), "QuorumNotMet", { countAsDetection: false });
      for (let i = 0; i < 8; i++) { await c.wait(600); await c.poke(`${(i + 1) * 10} min into outage`); }
    },
  })),

  // ------------------------------------------------------------------------------------------ recovery
  {
    id: "R1", group: "Recovery", truth: "risk", title: "Recovery after an attack",
    description: "Conflicting sources → DISPUTED; honest rounds return. Borrowing may reopen only after a newer accepted round AND the 1 h recovery delay.",
    required: "blocked", expected: "DISPUTED → RECOVERING → FRESH, never earlier than the delay", expectedState: "FRESH", trigger: "dispute, then recovery",
    sources: { online: 5, manipulated: 1 },
    run: async (o, c) => {
      await c.wait(600); c.onset("dispute"); await c.round([1500, 2500, 2510], { signers: 3, feed: false, record: false }); await c.poke("dispute");
      await c.end("honest data returns");
      await c.wait(60); await c.round(honestAll(2500)); await c.poke("honest round");
      await c.wait(1800); await c.round(honestAll(2500)); await c.poke("30 min later (delay not met)");
      c.assert("still frozen 30 min into recovery", !c.last().borrowOk, c.last().state);
      await c.wait(1800); await c.round(honestAll(2500)); await c.poke("60 min later");
      c.assert("borrowing reopened after new round + delay", c.last().borrowOk, c.last().state);
    },
  },
  {
    id: "R2", group: "Recovery", truth: "risk", title: "Relapse during recovery",
    description: "Pump → PROTECTIVE; price briefly normalises (RECOVERING); pump resumes within the recovery delay.",
    required: "blocked", expected: "Never reopens between the two pumps", expectedState: "PROTECTIVE", trigger: "+60%, pause, +60%",
    sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" },
    run: async (o, c) => {
      await c.hour(); c.onset("first pump"); await c.round(honestAll(4000)); await c.poke("first pump");
      for (let i = 0; i < 10 && c.last().state !== 4; i++) { await c.hour(); await c.round(honestAll(2500)); await c.poke("normalised"); }
      await c.wait(600); await c.round(honestAll(4000)); await c.poke("pump resumes inside the delay");
      c.assert("borrowing never reopened during the episode", c.obs().filter((x) => x.phase === "risk").every((x) => !x.borrowOk), "checked every poke");
    },
  },
  {
    id: "R3", group: "Recovery", truth: "risk", title: "Oracle outage, then recovery",
    description: "All sources go offline for 2 hours, then return.",
    required: "blocked", expected: "PROTECTIVE → RECOVERING → FRESH after new round + delay", expectedState: "FRESH", trigger: "0/5 online for 2 h",
    sources: { online: 0, manipulated: 0 },
    run: async (o, c) => {
      c.onset("outage begins");
      for (let i = 0; i < 12; i++) { await c.wait(600); await c.poke(`outage +${(i + 1) * 10} min`); }
      await c.end("sources return");
      for (let i = 0; i < 3; i++) { await c.hour(); await c.round(honestAll(2500)); await c.poke("sources back"); }
    },
  },
];

function r2(x) { return Math.round(x * 100) / 100; }

// ---------------------------------------------------------------------------------------------- runner

/**
 * Run one case against the chain behind `o` (caller is responsible for starting from the healthy snapshot).
 * @returns {Promise<object>} a plain, JSON-serialisable result
 */
export async function runCase(o, def, { onProgress = () => {} } = {}) {
  const obs = [];
  const rejections = [];
  const checks = [];
  let onsetT = null;
  let endT = null;
  let lastPrices = null;
  const startNonce = await o.read(o.D.verifier, o.A.verifier, "lastAcceptedNonce");
  const ilkSpot = async () => (await o.read(o.D.protectedVat, o.A.vat, "ilks", [o.D.ilk]))[2];

  const c = {
    onset: (label, t) => { onsetT = t ?? null; c._onsetLabel = label; if (t == null) c._pendingOnset = true; },
    end: async () => { endT = Number(await o.now()); },
    last: () => obs[obs.length - 1] ?? {},
    obs: () => obs,
    hour: () => o.osmHop(),
    wait: (s) => o.warp(BigInt(s)),
    setDepth: (usd) => o.setDepth(usd, { quiet: true }),
    assert: (label, cond, actual) => checks.push({ label, pass: !!cond, actual: String(actual) }),

    /** Relay a round: prices per signer; signers = count (first N) or accounts; feed follows unless feed:false. */
    async round(prices, { signers, feed = true, record, quiet = true, label } = {}) {
      const n = prices.length;
      const accts = Array.isArray(signers) ? signers : o.ACC.sources.slice(0, typeof signers === "number" ? signers : n);
      if (feed) await o.setFeed(prices[Math.floor(n / 2)]);
      await stampOnset();
      lastPrices = prices;
      const { rec } = await o.submitRound(prices, { signers: accts, recordSources: record ?? true, quiet, label: label ?? `round: ${prices.map((p) => `$${p}`).join(" / ")}` });
      // DISPUTED rounds are recorded by the verifier but never used as a price; recordSources is only valid for accepted ones
      return rec;
    },

    /** Submit a round that the verifier must reject. */
    async reject(label, round, reason, { countAsDetection = true } = {}) {
      await stampOnset();
      const { rec } = await o.submitRound([], { round, label: `${label} (must be rejected)`, expect: "revert", expectReason: reason, quiet: true });
      rejections.push({ label, expected: reason, reverted: rec.status === "reverted", reason: rec.reason, pass: rec.pass, countAsDetection, tx: rec.hash, block: rec.block });
    },

    async poke(label) {
      const pre = await o.readSnapshot();
      const spotBefore = await ilkSpot();
      const rec = await o.poke({ label: `poke() — ${label}`, quiet: true });
      const post = await o.readSnapshot();
      const t = Number(await o.now());
      await stampOnset(t);
      const [spotAfter, policyLine, borrow, repay, baseBorrow] = await Promise.all([
        ilkSpot(),
        o.read(o.D.sentinel, o.A.sentinel, "policyLine", [post.state]),
        o.probe(o.ACC.alice, "protected", 1_000, 1),
        o.probe(o.ACC.alice, "protected", 1_000, -1),
        o.probe(o.ACC.alice, "baseline", 1_000, 1),
      ]);
      const from = Number(pre.state);
      const to = Number(post.state);
      let transition = "none";
      let transitionOk = true;
      if (from !== to) {
        transition = `${STATE[from]}→${STATE[to]}`;
        if ((from === 2 || from === 3) && to <= 1) transitionOk = false; // restricted → open without RECOVERING
        if (from === 4 && to <= 1 && !(pre.recoveryRoundSeen && Number(pre.recoveryReadyAt) <= t)) transitionOk = false;
      }
      const line = post.line;
      const inv = {
        spotUnchanged: spotBefore === spotAfter,
        restrictedZeroLine: !RESTRICTED.has(to) || line === 0n,
        lineMatchesPolicy: line === policyLine,
        repayAvailable: repay.ok,
        restrictedBlocksBorrow: !RESTRICTED.has(to) || !borrow.ok,
      };
      const o2 = {
        label, t, block: rec.block, tx: rec.hash, state: STATE[to], stateIdx: to, target: STATE[Number(post.target)],
        flags: decodeFlags(post.flags).map((f) => f.key), line: line.toString(), debt: post.debt.toString(),
        headroom: (line > post.debt ? line - post.debt : 0n).toString(),
        borrowOk: borrow.ok, borrowReason: borrow.reason, repayOk: repay.ok, baselineBorrowOk: baseBorrow.ok,
        transition, transitionOk, invariants: inv,
      };
      obs.push(o2);
      onProgress(o2);
      return o2;
    },
  };

  async function stampOnset(t) {
    if (c._pendingOnset) { onsetT = t ?? Number(await o.now()); c._pendingOnset = false; }
  }

  let error = null;
  try {
    await def.run(o, c);
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0];
  }
  const endNonce = await o.read(o.D.verifier, o.A.verifier, "lastAcceptedNonce");
  for (const x of obs) x.phase = onsetT != null && x.t >= onsetT && (endT == null || x.t <= endT) ? "risk" : onsetT != null && x.t < onsetT ? "before" : endT != null && x.t > endT ? "after" : "risk";
  return evaluate(def, { obs, rejections, checks, onsetT, endT, error, lastPrices, acceptedDuringCase: Number(endNonce - startNonce) });
}

// ---------------------------------------------------------------------------------------------- evaluation

const meets = (required, stateIdx) => (required === "blocked" ? RESTRICTED.has(stateIdx) : required === "limited" ? stateIdx !== 0 : true);

export function evaluate(def, r) {
  const { obs } = r;
  const final = obs[obs.length - 1];
  const inRisk = obs.filter((x) => x.phase === "risk");
  const invariantViolations = [];
  for (const x of obs) for (const [k, v] of Object.entries(x.invariants)) if (!v) invariantViolations.push(`${k} @ ${x.label}`);
  const transitions = obs.filter((x) => x.transition !== "none");
  const transitionViolations = transitions.filter((x) => !x.transitionOk).map((x) => `${x.transition} @ ${x.label}`);
  const checksOk = r.checks.every((x) => x.pass);

  let outcome;
  let detected = null;
  let latencySeconds = null;
  let latencyNote = null;
  let lapsed = false;
  const onset = r.onsetT ?? obs[0]?.t ?? 0;

  let restriction = null;
  if (def.truth === "healthy") {
    const restricted = obs.filter((x) => x.stateIdx !== 0);
    outcome = restricted.length ? "FP" : "TN";
    const worst = Math.max(-1, ...restricted.map((x) => x.stateIdx));
    latencyNote = restricted.length ? `restricted at ${restricted.length} of ${obs.length} pokes (worst: ${STATE[worst]})` : null;
    if (restricted.length) {
      restriction = {
        pokes: restricted.length, of: obs.length, worst: STATE[worst],
        causes: [...new Set(restricted.flatMap((x) => x.flags))],
        blockedPokes: restricted.filter((x) => RESTRICTED.has(x.stateIdx)).length,
        returnedToFresh: final?.stateIdx === 0,
      };
    }
  } else if (def.truth === "risk" && def.required === "reject") {
    const relevant = r.rejections.filter((x) => x.countAsDetection);
    detected = relevant.length > 0 && relevant.every((x) => x.reverted && x.pass);
    outcome = detected ? "TP" : "FN";
    latencySeconds = detected ? 0 : null;
    latencyNote = detected ? "rejected in the submitting transaction" : "not rejected";
  } else if (def.truth === "risk") {
    const hit = inRisk.find((x) => meets(def.required, x.stateIdx));
    detected = !!hit;
    const lastRisk = inRisk[inRisk.length - 1];
    lapsed = !!lastRisk && detected && !meets(def.required, lastRisk.stateIdx);
    outcome = detected && !lapsed ? "TP" : "FN";
    if (hit) { latencySeconds = Math.max(0, hit.t - onset); latencyNote = `${inRisk.indexOf(hit) + 1} poke(s) after onset`; }
    else latencyNote = "required protection never reached";
    if (lapsed) latencyNote += ` · lapsed to ${lastRisk.state} while the risk persisted`;
  } else {
    outcome = final && final.state === def.expectedState ? "MATCH" : "MISMATCH";
    const hit = obs.find((x) => x.t >= onset && meets(def.required, x.stateIdx));
    if (hit) latencySeconds = Math.max(0, hit.t - onset);
  }

  const correct = outcome === "TP" || outcome === "TN" || outcome === "MATCH";
  const pass = correct && invariantViolations.length === 0 && transitionViolations.length === 0 && checksOk && !r.error;
  return {
    id: def.id, group: def.group, truth: def.truth, title: def.title, description: def.description, trigger: def.trigger,
    sources: def.sources, required: def.required, expected: def.expected, expectedState: def.expectedState ?? null,
    lastPrices: r.lastPrices,
    actual: {
      finalState: final?.state ?? null, finalPolicy: final ? POLICY_TEXT[final.stateIdx] : null,
      finalLine: final?.line ?? null, finalDebt: final?.debt ?? null, finalHeadroom: final?.headroom ?? null,
      statesSeen: [...new Set(obs.map((x) => x.state))], borrowProbeFinal: final?.borrowOk ?? null, repayProbeFinal: final?.repayOk ?? null,
      baselineBorrowFinal: final?.baselineBorrowOk ?? null, acceptedRounds: r.acceptedDuringCase,
    },
    outcome, detected, lapsed, latencySeconds, latencyNote, restriction,
    rejections: r.rejections, checks: r.checks,
    invariantViolations, transitions: transitions.map((x) => x.transition), transitionViolations,
    pokes: obs.length, observations: obs, onsetT: r.onsetT, endT: r.endT,
    error: r.error, pass,
  };
}

// ---------------------------------------------------------------------------------------------- metrics

const ratio = (a, b) => (b === 0 ? null : a / b);

export function summarize(results) {
  const n = (f) => results.filter(f).length;
  const TP = n((r) => r.outcome === "TP");
  const FN = n((r) => r.outcome === "FN");
  const TN = n((r) => r.outcome === "TN");
  const FP = n((r) => r.outcome === "FP");
  const lat = results.filter((r) => r.outcome === "TP" && r.required !== "reject" && r.latencySeconds != null).map((r) => r.latencySeconds).sort((a, b) => a - b);
  const allObs = results.flatMap((r) => r.observations);
  const transitions = results.reduce((a, r) => a + r.transitions.length, 0);
  return {
    total: results.length,
    risk: n((r) => r.truth === "risk"),
    healthy: n((r) => r.truth === "healthy"),
    degraded: n((r) => r.truth === "degraded"),
    TP, FN, TN, FP,
    degradedMatch: n((r) => r.outcome === "MATCH"),
    degradedMismatch: n((r) => r.outcome === "MISMATCH"),
    healthyPokes: results.filter((r) => r.truth === "healthy").reduce((a, r) => a + r.pokes, 0),
    healthyRestrictedPokes: results.filter((r) => r.truth === "healthy").reduce((a, r) => a + (r.restriction?.pokes ?? 0), 0),
    healthyBlockedPokes: results.filter((r) => r.truth === "healthy").reduce((a, r) => a + (r.restriction?.blockedPokes ?? 0), 0),
    precision: ratio(TP, TP + FP),
    recall: ratio(TP, TP + FN),
    falsePositiveRate: ratio(FP, FP + TN),
    verifierRejections: n((r) => r.required === "reject" && r.outcome === "TP"),
    latency: lat.length ? { cases: lat.length, min: lat[0], median: lat[Math.floor((lat.length - 1) / 2)], max: lat[lat.length - 1] } : null,
    pokes: allObs.length,
    invariantChecks: allObs.length * 5,
    invariantViolations: results.reduce((a, r) => a + r.invariantViolations.length, 0),
    transitions,
    transitionViolations: results.reduce((a, r) => a + r.transitionViolations.length, 0),
    errors: n((r) => !!r.error),
    passed: n((r) => r.pass),
  };
}

export const HOUR_S = Number(HOUR);

// ---------------------------------------------------------------------------------------------- holdout suite
// A SEPARATE, parameterised set with magnitudes and shapes that do not appear in CASES. Written before any
// rule change and never used to choose one: it only measures how a rule generalises. Ground truth is fixed
// by construction (honest market vs manipulated / failed oracle).

const healthyPath = (id, title, description, trigger, path, { signers = 5 } = {}) => ({
  id, group: "Holdout", truth: "healthy", title, description, required: "none", expected: "Ideally FRESH", expectedState: "FRESH", trigger,
  sources: { online: signers, manipulated: 0 }, holdout: true,
  run: async (o, c) => { for (const p of path) { await c.hour(); await c.round(Array(signers).fill(p), { signers }); await c.poke(`$${p}`); } },
});
const pumpHold = (id, title, pct, hours, { depth } = {}) => ({
  id, group: "Holdout", truth: "risk", title, description: `The market is manipulated +${pct}% and every source honestly reports it; held ${hours} h${depth ? ` (depth assumption $${depth.toLocaleString("en-US")}/1%)` : ""}.`,
  required: "limited", expected: "Restricted while the manipulation lasts", expectedState: "PROTECTIVE", trigger: `+${pct}% for ${hours} h`,
  sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" }, holdout: true,
  run: async (o, c) => {
    if (depth) await c.setDepth(depth);
    const p = r2(2500 * (1 + pct / 100));
    await c.hour(); c.onset("manipulated round"); await c.round(honestAll(p)); await c.poke(`+${pct}%`);
    for (let i = 1; i < hours; i++) { await c.hour(); await c.round(honestAll(p)); await c.poke("hold"); }
  },
});

export const HOLDOUT = [
  healthyPath("X1", "Rally +1%/h for 6 h", "Honest rally.", "+1%/h", [2525, 2550.25, 2575.75, 2601.51, 2627.53, 2653.8]),
  healthyPath("X2", "Rally +3%/h for 5 h", "Honest strong rally.", "+3%/h", [2575, 2652.25, 2731.82, 2813.77, 2898.18]),
  healthyPath("X3", "Decline −1%/h for 6 h", "Honest decline.", "−1%/h", [2475, 2450.25, 2425.75, 2401.49, 2377.47, 2353.7]),
  healthyPath("X4", "Step −4% then flat", "Honest one-hour −4% move, then 3 flat hours.", "−4%", [2400, 2400, 2400, 2400]),
  healthyPath("X5", "Noise ±1.5% for 6 h", "Honest oscillation around $2,500.", "±1.5%", [2537.5, 2462.5, 2537.5, 2462.5, 2537.5, 2462.5]),
  healthyPath("X6", "Spike +4% then back", "Honest one-hour +4% spike, then back to $2,500.", "+4% for 1 h", [2600, 2500, 2500, 2500]),
  healthyPath("X7", "Flat, 4 of 5 sources", "Stable market, one source offline.", "1 source offline", [2500, 2500, 2500], { signers: 4 }),
  pumpHold("X8", "Pump +20% held 2 h", 20, 2),
  pumpHold("X9", "Pump +45% held 2 h", 45, 2),
  pumpHold("X10", "Pump +150% held 1 h", 150, 1),
  pumpHold("X11", "Pump +45% held 8 h, thin market", 45, 8, { depth: 2_000 }),
  {
    id: "X12", group: "Holdout", truth: "risk", title: "Creeping +6%/h for 6 h", description: "Price walked up 6% per hour (+42%).",
    required: "limited", expected: "Restricted", expectedState: "PROTECTIVE", trigger: "+6%/h", sources: { online: 5, manipulated: 5, note: "sources honest, market manipulated" }, holdout: true,
    run: async (o, c) => { let p = 2500; for (let i = 0; i < 6; i++) { p = r2(p * 1.06); await c.hour(); if (i === 0) c.onset("first step"); await c.round(honestAll(p)); await c.poke(`$${p}`); } },
  },
  ...[[3, 20, "X13"], [4, 100, "X14"]].map(([k, pct, id]) => ({
    id, group: "Holdout", truth: "risk", title: `${k} colluding sources at +${pct}%, only theirs relayed`, description: `A valid ${k}-of-5 round at +${pct}% while the real market (feed) stays at $2,500.`,
    required: "blocked", expected: "PROTECTIVE", expectedState: "PROTECTIVE", trigger: `valid ${k}/5 round +${pct}%`, sources: { online: 5, manipulated: k, note: "valid signatures, false price" }, holdout: true,
    run: async (o, c) => { await c.wait(600); c.onset("colluding round"); await c.round(Array(k).fill(r2(2500 * (1 + pct / 100))), { signers: k, feed: false }); await c.poke("colluding round"); },
  })),
  {
    id: "X15", group: "Holdout", truth: "risk", title: "2 of 5 sources at +20%, all relayed", description: "Two sources lie by +20%; all five signatures are relayed.",
    required: "blocked", expected: "DISPUTED", expectedState: "DISPUTED", trigger: "2/5 lie +20%", sources: { online: 5, manipulated: 2 }, holdout: true,
    run: async (o, c) => { await c.wait(600); c.onset("mixed round"); await c.round([3000, 3000, 2500, 2500, 2500], { feed: false, record: false }); await c.poke("mixed"); },
  },
  ...[[15, "X16"], [60, "X17"]].map(([pct, id]) => ({
    id, group: "Holdout", truth: "risk", title: `Feed frozen, market −${pct}%`, description: `The market falls ${pct}%; sources report it, the Chainlink-style feed and OSM stay at $2,500.`,
    required: "blocked", expected: "PROTECTIVE", expectedState: "PROTECTIVE", trigger: `feed frozen, −${pct}%`, sources: { online: 5, manipulated: 0, note: "feed stale" }, holdout: true,
    run: async (o, c) => { await c.wait(600); c.onset("divergence"); await c.round(honestAll(r2(2500 * (1 - pct / 100))), { feed: false }); await c.poke("sources vs frozen feed"); },
  })),
  {
    id: "X18", group: "Holdout", truth: "risk", title: "1 of 5 sources online for 90 min", description: "Four sources offline; polled every 15 minutes.",
    required: "blocked", expected: "PROTECTIVE once stale", expectedState: "PROTECTIVE", trigger: "4 sources offline", sources: { online: 1, manipulated: 0 }, holdout: true,
    run: async (o, c) => { c.onset("outage"); for (let i = 0; i < 6; i++) { await c.wait(900); await c.poke(`${(i + 1) * 15} min`); } },
  },
  {
    id: "X19", group: "Holdout", truth: "degraded", title: "3 of 5 sources, rising market", description: "Exactly the quorum signs a +1%/h market for 3 h.",
    required: "limited", expected: "WATCH (minimum quorum)", expectedState: "WATCH", trigger: "2 sources offline", sources: { online: 3, manipulated: 0 }, holdout: true,
    run: async (o, c) => { c.onset("2 sources offline"); for (const p of [2525, 2550.25, 2575.75]) { await c.hour(); await c.round([p, p, p], { signers: 3 }); await c.poke(`$${p}`); } },
  },
];
