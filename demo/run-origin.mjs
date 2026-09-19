// Origin // ASO Sentinel — full on-chain demo on a fresh LOCAL anvil chain (never a public network).
// Covers demo items 1–16 plus every dashboard scenario (A–E) and the presentation sequence.
// Every step is a real transaction; expected reverts are mined. Exits 1 on any unexpected outcome.
//
//   cd demo && npm run demo:origin
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, createTestClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createOrigin, SCENARIOS, PRESENTATION, STATE, decodeFlags } from "../shared/origin-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const START_TS = 1_800_000_000;

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", d: "\x1b[2m", x: "\x1b[0m" };
const log = (...a) => console.log(...a);
const title = (t) => log(`\n${C.b}${C.c}━━ ${t} ${"━".repeat(Math.max(0, 74 - t.length))}${C.x}`);
const note = (t) => log(`   ${C.d}${t}${C.x}`);

function bin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : name;
}

// anvil PUBLIC test keys — local only
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
].map((k) => privateKeyToAccount(k));
const ACCOUNTS = {
  admin: KEYS[0], feeder: KEYS[1], alice: KEYS[2], mallory: KEYS[3], bob: KEYS[4],
  sources: KEYS.slice(5).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)),
  outsider: privateKeyToAccount(`0x${"11".repeat(32)}`),
};

let anvil;
async function startChain() {
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--timestamp", String(START_TS), "--silent"], { stdio: "ignore" });
  const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 100; i++) {
    try { await pc.getChainId(); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("anvil did not start");
}

function deploy() {
  const r = spawnSync(bin("forge"), ["script", "script/DeployOrigin.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) { log(r.stdout, r.stderr); throw new Error("forge script DeployOrigin failed"); }
  return JSON.parse(readFileSync(join(ROOT, "deployments", "31337-origin.json"), "utf8"));
}

const fmtUsd = (wad) => `$${(Number(wad / 10n ** 16n) / 100).toLocaleString("en-US")}`;
const fmtRad = (rad) => `${(Number(rad / 10n ** 43n) / 100).toLocaleString("en-US")}`;

async function main() {
  title("Setup: fresh anvil + forge script DeployOrigin (local only)");
  await startChain();
  const D = deploy();
  const abis = JSON.parse(readFileSync(join(ROOT, "shared", "abis.json"), "utf8"));
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const walletFor = (account) => createWalletClient({ account, chain: foundry, transport: http(RPC) });
  const o = createOrigin({
    publicClient, testClient, walletFor, deployment: D, abis, accounts: ACCOUNTS,
    onTx: (r) => {
      if (r.quiet && r.pass) return;
      const mark = r.kind === "check" ? (r.pass ? `${C.g}✔` : `${C.r}✖`) : r.status === "success" ? `${C.g}✔ SUCCESS ` : `${C.r}✖ REVERTED`;
      log(`   ${mark}${C.x} ${r.label}${r.kind === "check" ? `  ${C.d}${r.actual}${C.x}` : ""}`);
      if (r.kind === "tx") log(`     ${C.d}tx ${r.hash.slice(0, 18)}… block ${r.block}${r.reason ? `  reason: ${C.x}${C.y}${r.reason}` : ""}${C.x}`);
      if (!r.pass) log(`     ${C.r}${C.b}UNEXPECTED OUTCOME${r.expect ? ` (expected ${r.expect}${r.expectReason ? `: ${r.expectReason}` : ""})` : ""}${C.x}`);
    },
  });
  note(`OriginSentinel ${D.sentinel} · ASORiskEngine ${D.riskEngine} · ASOVerifier ${D.verifier}`);

  const state = async () => STATE[await o.readState()];
  const expectState = async (item, want) => {
    const s = await state();
    o.check(`[${item}] Sentinel state is ${want}`, s === want, s);
  };
  const expectFlag = async (item, key) => {
    const snap = await o.readSnapshot();
    const keys = decodeFlags(snap.flags).map((f) => f.key);
    o.check(`[${item}] active signal ${key}`, keys.includes(key), keys.join(", ") || "none");
  };
  const panel = async (heading) => {
    const r = await o.readAll();
    const s = r.snapshot;
    log(`   ${C.b}┌ ${heading}${C.x}`);
    log(`   │ Sentinel ${STATE[s.state]} (target ${STATE[s.target]})  signals: ${decodeFlags(s.flags).map((f) => f.key).join(", ") || "none"}`);
    log(`   │ attested ${fmtUsd(s.attestedPrice)}  effective ${fmtUsd(s.effectivePrice)}  TWAP ${s.twapOk ? fmtUsd(s.twap) : "insufficient"}  Vat lends at ${fmtUsd(s.vatPrice)}`);
    log(`   │ protected line ${fmtRad(s.line)} / debt ${fmtRad(s.debt)}   baseline line ${fmtRad(r.baseline.line)} / debt ${fmtRad(r.baseline.debt)}`);
    log(`   └`);
  };

  // ------------------------------------------------------------------ 1–2
  title("1–2 · Healthy 3-of-5 rounds, warm-up through RECOVERING, normal borrowing");
  await o.bootstrap();
  o.check("[1] verifier status OK after healthy rounds", (await o.readAll()).verifier.status === 1, "OK");
  const r0 = await o.readAll();
  o.check("[2] Alice borrowed 50,000 on both markets", r0.urns.alice.baseline.art === 50_000n * 10n ** 18n && r0.urns.alice.protected.art === 50_000n * 10n ** 18n, "50,000 / 50,000");
  await panel("healthy");
  const SNAP = await testClient.snapshot();
  let snapId = SNAP;
  const restore = async (label) => {
    await testClient.revert({ id: snapId });
    snapId = await testClient.snapshot();
    note(`(chain restored to the healthy snapshot for: ${label})`);
  };

  // ------------------------------------------------------------------ 3–6
  title("3–6 · Forged signature, unauthorised signer, duplicate signer, replay");
  for (const step of SCENARIOS.find((s) => s.id === "attacks").steps) await step.run(o);

  // ------------------------------------------------------------------ 7–10
  await restore("7–10");
  title("7–10 · Disagreement → DISPUTED → borrow blocked → repayment → recovery");
  await o.submitRound([1500, 2500, 2510], { label: "Round: sources disagree (1500 / 2500 / 2510)" });
  await o.poke();
  await expectState(7, "DISPUTED");
  await o.borrow(o.ACC.bob, "Bob", "protected", 1_000, { expect: "revert", expectReason: "Vat/ceiling-exceeded", check: "8" });
  await o.repay(o.ACC.alice, "Alice", "protected", 10_000, { check: "9" });
  await o.warp(60n);
  await o.freshAt(2500);
  await o.poke();
  await expectState(10, "RECOVERING");
  await o.warp(3600n);
  await o.freshAt(2500);
  await o.poke();
  await expectState(10, "FRESH");
  await o.borrow(o.ACC.bob, "Bob", "protected", 1_000, { check: "10" });

  // ------------------------------------------------------------------ 11
  await restore("11");
  title("11 · Stale oracle: no rounds for longer than maxAge; expired attestation");
  const late = await o.signRound([2500, 2500, 2500]);
  await o.warp(3601n);
  await o.poke();
  await expectState(11, "PROTECTIVE");
  await expectFlag(11, "ASO_STALE");
  await o.submitRound([2500, 2500, 2500], { round: late, label: "Round signed an hour ago, submitted now", expect: "revert", expectReason: "Expired" });

  // ------------------------------------------------------------------ 12
  await restore("12");
  title("12 · Market vs oracle: feed frozen at $2,500, sources see $1,500");
  for (const step of SCENARIOS.find((s) => s.id === "D").steps) await step.run(o);
  await expectFlag(12, "VAT_ABOVE_EFFECTIVE");
  await expectState(12, "PROTECTIVE");
  await panel("stale oracle");

  // ------------------------------------------------------------------ 13
  await restore("13");
  title("13 · Manipulation-cost warning (depth is a governance ASSUMPTION)");
  await o.setDepth(1_000);
  await o.poke({ label: "poke() with $1,000 per 1% depth" });
  await expectFlag(13, "COST_ELEVATED");
  await expectState(13, "WATCH");
  // Alice already borrowed 50k this epoch, so the bounded headroom is 50k: a smaller prize makes manipulation
  // LESS attractive. It takes a thinner market ($200 per 1%) for the cost gate to reach HIGH here.
  await o.setDepth(200);
  await o.poke({ label: "poke() with $200 per 1% depth" });
  await expectFlag(13, "COST_HIGH");
  await expectState(13, "PROTECTIVE");

  // ------------------------------------------------------------------ 14–15
  await restore("14–15");
  title("14–15 · Thin-market pump: baseline bad debt vs protected restriction");
  for (const step of SCENARIOS.find((s) => s.id === "A").steps) await step.run(o);
  const rA = await o.readAll();
  const m = rA.urns.mallory;
  const badDebt = m.baseline.art - m.baseline.ink * 2500n; // at the fair $2,500
  o.check("[14] baseline: Mallory's debt exceeds her collateral at fair value (bad debt)", badDebt > 0n, `${fmtUsd(badDebt)} bad debt at $2,500`);
  o.check("[15] protected: Mallory has no debt", m.protected.art === 0n, `${m.protected.art}`);
  await expectState(15, "PROTECTIVE");
  await panel("after pump");

  // ------------------------------------------------------------------ 16
  await restore("16");
  title("16 · Epoch borrowing-growth cap (100,000 rwaUSD net per day)");
  for (const w of ["protected"]) await o.deposit(o.ACC.mallory, "Mallory", w, 200);
  await o.borrow(o.ACC.mallory, "Mallory", "protected", 50_000, { check: "16" });
  await o.borrow(o.ACC.mallory, "Mallory", "protected", 1, { expect: "revert", expectReason: "Vat/ceiling-exceeded", check: "16" });
  note("Next epoch: advance ~1 day, keep data fresh, poke");
  await o.warp(86_400n);
  await o.freshAt(2500);
  await o.poke();
  await o.borrow(o.ACC.mallory, "Mallory", "protected", 100_000, { check: "16" });
  await o.borrow(o.ACC.mallory, "Mallory", "protected", 1, { expect: "revert", expectReason: "Vat/ceiling-exceeded", check: "16" });

  // ------------------------------------------------------------------ dashboard scenarios + presentation
  for (const id of ["B", "C", "E"]) {
    await restore(id);
    const sc = SCENARIOS.find((s) => s.id === id);
    title(`Dashboard scenario ${sc.title}`);
    for (const step of sc.steps) await step.run(o);
    if (id === "B") {
      const r = await o.readAll();
      const s = r.snapshot;
      o.check("[B] reopened only in WATCH, not FRESH", STATE[s.state] === "WATCH", STATE[s.state]);
      o.check("[B] headroom bounded by WATCH gap", s.line - s.debt <= (r.limits[1] * BigInt(r.limits[2])) / 10_000n, `${fmtRad(s.line - s.debt)} rwaUSD`);
    }
    if (id === "C") await expectState("C", "FRESH");
    if (id === "E") await expectState("E", "FRESH");
  }
  await restore("presentation");
  title("Presentation mode sequence");
  const want = [null, "DISPUTED", "RECOVERING", "PROTECTIVE", "PROTECTIVE", "RECOVERING", null];
  for (let i = 0; i < PRESENTATION.length; i++) {
    await PRESENTATION[i].run(o);
    if (want[i]) await expectState(`P${i + 1}`, want[i]);
  }
  const last = await state();
  o.check("[P7] borrowing reopened after recovery", last === "FRESH" || last === "WATCH", last);

  // ------------------------------------------------------------------ results
  title("RESULTS (expected vs actual, from mined transactions and contract state)");
  const graded = o.records.filter((r) => r.kind === "check" || r.expect === "revert" || r.check || !r.quiet);
  const failed = graded.filter((r) => !r.pass);
  log(`   ${graded.length - failed.length}/${graded.length} graded steps behaved as expected`);
  for (const f of failed) log(`   ${C.r}FAIL${C.x}  ${f.label}  ${C.d}${f.actual ?? f.reason ?? f.status}${C.x}`);
  log(failed.length === 0 ? `\n   ${C.g}${C.b}ALL ORIGIN SCENARIOS BEHAVED AS EXPECTED${C.x}` : `\n   ${C.r}${C.b}SOME SCENARIOS DID NOT BEHAVE AS EXPECTED${C.x}`);
  return failed.length === 0;
}

main()
  .then((ok) => { anvil?.kill(); process.exit(ok ? 0 : 1); })
  .catch((e) => { console.error(e); anvil?.kill(); process.exit(1); });
