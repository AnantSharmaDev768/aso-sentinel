// Deterministic on-chain demo: Multipli baseline vs ASO-protected lending on a local anvil chain.
// Every step is a real transaction. Failing steps are MINED (fixed gas) so they appear on-chain with
// status "reverted"; the revert reason is decoded from an eth_call of the same call.
//
//   cd demo && npm install && npm run demo
//
// Requires Foundry (anvil + forge) on PATH or in ~/.foundry/bin.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import {
  createPublicClient, createWalletClient, createTestClient, http,
  ContractFunctionRevertedError, BaseError, formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const START_TS = 1_800_000_000;
const HOUR = 3600n;

// ------------------------------------------------------------------ tooling
function bin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : name;
}
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", d: "\x1b[2m", x: "\x1b[0m" };
const log = (...a) => console.log(...a);
const title = (t) => log(`\n${C.b}${C.c}━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}${C.x}`);
const note = (t) => log(`   ${C.d}${t}${C.x}`);
// `npm run demo -- --step` pauses before each act (for live narration)
const STEP = process.argv.includes("--step");
let rl = null;
let stdinClosed = false;
async function pause() {
  if (!STEP || stdinClosed) return;
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("close", () => { stdinClosed = true; });
  }
  try {
    await rl.question(`${C.d}   [press Enter to continue]${C.x}`);
  } catch {
    stdinClosed = true; // stdin ended (e.g. piped input): continue without pausing
  }
}

// anvil public test keys (#0..#9) — local demo only
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
const [admin, feeder, alice, mallory, bob] = KEYS;
const keeper = admin; // anyone may relay rounds and poke; the admin account just pays gas here
const sources = KEYS.slice(5).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));

const abi = (file, name) => JSON.parse(readFileSync(join(ROOT, "out", file, `${name}.json`))).abi;

// ------------------------------------------------------------------ chain + deploy
let anvil;
async function startChain() {
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--timestamp", String(START_TS), "--silent"], { stdio: "ignore" });
  const pc = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  for (let i = 0; i < 100; i++) {
    try { await pc.getChainId(); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("anvil did not start");
}

function deploy() {
  const r = spawnSync(bin("forge"), ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], {
    cwd: ROOT, encoding: "utf8",
  });
  if (r.status !== 0) { log(r.stdout, r.stderr); throw new Error("forge script failed"); }
  return JSON.parse(readFileSync(join(ROOT, "deployments", "31337.json"), "utf8"));
}

// ------------------------------------------------------------------ main
const results = [];

async function main() {
  title("Setup: fresh anvil chain + deploy (forge script)");
  await startChain();
  const D = deploy();
  note(`baseline Vat  ${D.baselineVat}   (Multipli verified Vat, no protection)`);
  note(`protected Vat ${D.protectedVat}   (same code + ASOSentinel as ward)`);
  note(`ASOVerifier   ${D.verifier}   ASOSentinel ${D.sentinel}`);

  const pc = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const tc = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const wallet = (acct) => createWalletClient({ account: acct, chain: foundry, transport: http(RPC) });

  const A = {
    vat: abi("vat.sol", "Vat"), spot: abi("spot.sol", "Spotter"), osm: abi("osm.sol", "OSM"),
    adapter: abi("adapter.sol", "PriceFeedAdapter"), join: abi("join.sol", "GemJoin5"),
    verifier: abi("ASOVerifier.sol", "ASOVerifier"), sentinel: abi("ASOSentinel.sol", "ASOSentinel"),
    feed: abi("MockAggregator.sol", "MockAggregator"), gem: abi("MockRWA.sol", "MockRWA"),
  };
  const ILK = D.ilk;
  const WAD = 10n ** 18n, RAY = 10n ** 27n, RAD = 10n ** 45n;
  const read = (address, a, functionName, args = [], account) =>
    pc.readContract({ address, abi: a, functionName, args, account });

  // ---- send a real tx; decode revert reason; record expected vs actual
  async function tx(label, acct, address, a, functionName, args, expect = "success", scenario = null, quiet = false) {
    let reason = null;
    try {
      await pc.simulateContract({ account: acct, address, abi: a, functionName, args });
    } catch (e) {
      const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      if (rev?.data?.errorName) reason = `${rev.data.errorName}(${(rev.data.args ?? []).join(", ")})`;
      else reason = rev?.reason ?? e.shortMessage ?? String(e);
    }
    const hash = await wallet(acct).writeContract({ address, abi: a, functionName, args, gas: 3_000_000n });
    const rc = await pc.waitForTransactionReceipt({ hash });
    const ok = rc.status === "success";
    const pass = (expect === "success") === ok;
    const mark = ok ? `${C.g}✔ SUCCESS${C.x}` : `${C.r}✖ REVERTED${C.x}`;
    if (quiet && ok && pass) return { ok, reason, rc };
    log(`   ${mark} ${label}`);
    log(`     ${C.d}tx ${hash.slice(0, 18)}… block ${rc.blockNumber}${reason ? `  reason: ${C.x}${C.y}${reason}` : ""}${C.x}`);
    if (scenario) results.push({ scenario, label, expect, actual: ok ? "success" : `revert: ${reason}`, pass });
    if (!pass) log(`     ${C.r}${C.b}UNEXPECTED OUTCOME (expected ${expect})${C.x}`);
    return { ok, reason, rc };
  }
  const check = (scenario, label, cond, detail) => {
    results.push({ scenario, label, expect: "true", actual: detail, pass: !!cond });
    log(`   ${cond ? C.g + "✔" : C.r + "✖"} ${label}${C.x}  ${C.d}${detail}${C.x}`);
  };
  async function warp(seconds) {
    await tc.increaseTime({ seconds: Number(seconds) });
    await tc.mine({ blocks: 1 });
  }
  const now = async () => (await pc.getBlock()).timestamp;

  // ---- attestations
  const STATUS = ["NO_DATA", "OK", "STALE", "DISPUTED", "HALTED"];
  const REASON = ["HEALTHY", "ASO_HALTED", "ASO_DISPUTED", "ASO_NO_DATA", "ASO_STALE", "FEED_STALE",
    "VAT_PRICE_ABOVE_ATTESTED", "AWAITING_FRESH_ROUND"];
  const domain = { name: "ASO Verifier", version: "1", chainId: 31337, verifyingContract: D.verifier };
  const types = { PriceAttestation: [
    { name: "profileId", type: "bytes32" }, { name: "price", type: "uint256" },
    { name: "validAfter", type: "uint64" }, { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint64" }, { name: "source", type: "address" } ] };
  let nonce = 0n;
  async function signRound(usdPrices, n = ++nonce, signers = sources) {
    const t = await now();
    const atts = [], sigs = [];
    for (let i = 0; i < usdPrices.length; i++) {
      const a = { profileId: D.profileId, price: BigInt(usdPrices[i]) * WAD, validAfter: t, validUntil: t + HOUR, nonce: n, source: signers[i].address };
      atts.push(a);
      sigs.push(await signers[i].signTypedData({ domain, types, primaryType: "PriceAttestation", message: a }));
    }
    return { atts, sigs };
  }
  const submit = (label, round, expect, scenario) =>
    tx(label, keeper, D.verifier, A.verifier, "submitRound", [round.atts, round.sigs], expect, scenario);
  const poke = (label = "Keeper: ASOSentinel.poke()") => tx(label, keeper, D.sentinel, A.sentinel, "poke", []);

  // ---- vault actions
  async function deposit(who, name, sys, wad) {
    const [vat, join_] = sys === "baseline" ? [D.baselineVat, D.baselineJoin] : [D.protectedVat, D.protectedJoin];
    await tx(`${name}: approve mPAXG`, who, D.gem, A.gem, "approve", [join_, wad], "success", null, true);
    await tx(`${name}: GemJoin5.join`, who, join_, A.join, "join", [who.address, wad], "success", null, true);
    const r = await tx(`${name}: Vat.frob lock collateral`, who, vat, A.vat, "frob", [ILK, who.address, who.address, who.address, wad, 0n], "success", null, true);
    log(`   ${C.g}✔ SUCCESS${C.x} ${name}: deposit ${formatUnits(wad, 18)} mPAXG as collateral in ${sys.toUpperCase()} Vat ${C.d}(approve → GemJoin5.join → Vat.frob, block ${r.rc.blockNumber})${C.x}`);
  }
  const borrow = (who, name, sys, wad, expect, scenario) =>
    tx(`${name}: borrow ${fmt(formatUnits(wad, 18))} rwaUSD on ${sys.toUpperCase()} Vat`, who,
      sys === "baseline" ? D.baselineVat : D.protectedVat, A.vat, "frob",
      [ILK, who.address, who.address, who.address, 0n, wad], expect, scenario);
  const repay = (who, name, sys, wad, expect, scenario) =>
    tx(`${name}: repay ${fmt(formatUnits(wad, 18))} rwaUSD on ${sys.toUpperCase()} Vat`, who,
      sys === "baseline" ? D.baselineVat : D.protectedVat, A.vat, "frob",
      [ILK, who.address, who.address, who.address, 0n, -wad], expect, scenario);

  async function osmHop() {
    await warp(HOUR);
    await tx("Anyone: OSM.poke()", keeper, D.osm, A.osm, "poke", [], "success", null, true);
    await tx("Anyone: Spotter.poke (baseline)", keeper, D.baselineSpotter, A.spot, "poke", [ILK], "success", null, true);
    const r = await tx("Anyone: Spotter.poke (protected)", keeper, D.protectedSpotter, A.spot, "poke", [ILK], "success", null, true);
    log(`   ${C.g}✔ SUCCESS${C.x} +1h → OSM.poke() → Spotter.poke() on both Vats ${C.d}(block ${r.rc.blockNumber})${C.x}`);
  }

  // ---- state panel (all values read from contracts)
  const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const usd = (w) => `$${fmt(formatUnits(w, 18))}`;
  const rad = (r) => fmt(r / RAD);
  async function state(heading) {
    const t = await now();
    const [, answer, , updatedAt] = await read(D.feed, A.feed, "latestRoundData");
    const [, adapterOk] = await read(D.adapter, A.adapter, "peek");
    const [osmVal, osmHas] = await read(D.osm, A.osm, "peek", [], admin.address);
    const [asoPrice, asoStatus] = await read(D.verifier, A.verifier, "getPrice", [D.profileId]);
    const [lastNonce, accepted] = await Promise.all([read(D.verifier, A.verifier, "lastNonce"), read(D.verifier, A.verifier, "lastAcceptedNonce")]);
    const vatPrice = await read(D.sentinel, A.sentinel, "vatPrice");
    const [bArt, , , bLine] = await read(D.baselineVat, A.vat, "ilks", [ILK]);
    const [pArt, , , pLine] = await read(D.protectedVat, A.vat, "ilks", [ILK]);
    const restricted = await read(D.sentinel, A.sentinel, "restricted");
    const evalR = await read(D.sentinel, A.sentinel, "evaluate");
    log(`   ${C.b}┌ STATE — ${heading}${C.x}  ${C.d}(chain time +${((Number(t) - START_TS) / 3600).toFixed(1)}h)${C.x}`);
    log(`   │ Feed (mock Chainlink)  ${usd(answer * 10n ** 10n)}  updated ${((Number(t - updatedAt)) / 3600).toFixed(1)}h ago   Multipli adapter valid: ${adapterOk ? C.g + "yes" : C.r + "NO (stale)"}${C.x}`);
    log(`   │ Multipli OSM serves    ${usd(BigInt(osmVal))}  has=${osmHas}   → both Vats lend at ${usd(vatPrice)}`);
    log(`   │ ASO verifier           ${usd(asoPrice)}  status=${asoStatus === 1 ? C.g : C.r}${STATUS[asoStatus]}${C.x}  nonce=${lastNonce} (accepted ${accepted})`);
    log(`   │ BASELINE  Vat          line ${rad(bLine)}  debt ${fmt(formatUnits(bArt, 18))} rwaUSD`);
    log(`   │ PROTECTED Vat          line ${pLine === 0n ? C.r : C.g}${rad(pLine)}${C.x}  debt ${fmt(formatUnits(pArt, 18))} rwaUSD   Sentinel: ${restricted ? C.r + "RESTRICTED" : C.g + "open"}${C.x} (evaluate=${REASON[evalR]})`);
    log(`   └`);
    return { asoStatus, pLine, restricted, evalR, osmVal: BigInt(osmVal), osmHas, adapterOk };
  }

  // ==================================================================================== setup
  note("Priming Multipli's OSM (two pokes one hour apart) so it serves the $2,500 feed price");
  await tx("Anyone: OSM.poke()", keeper, D.osm, A.osm, "poke", [], "success", null, true);
  await osmHop();

  // ==================================================================================== ACT 1
  await pause();
  title("ACT 1 — Normal operation: fresh signed attestations → borrowing works  [S1]");
  let r1 = await signRound([2500, 2500, 2501]);
  await submit("Relayer: submitRound (3-of-5 sources sign PAXG = $2,500)", r1, "success", "S1");
  await poke("Keeper: ASOSentinel.poke() → HEALTHY, opens headroom");
  for (const sys of ["baseline", "protected"]) await deposit(alice, "Alice", sys, 100n * WAD);
  await borrow(alice, "Alice", "baseline", 100_000n * WAD, "success", "S1");
  await borrow(alice, "Alice", "protected", 100_000n * WAD, "success", "S1");
  await state("healthy");

  // ==================================================================================== ACT 2
  await pause();
  title("ACT 2 — Attacks on the attestation itself (all rejected on-chain)  [S4, S5]");
  let bad = await signRound([2500, 2500, 2500]);
  bad.atts[1] = { ...bad.atts[1], price: 9_999n * WAD };
  await submit("Forged price under a real source's signature", bad, "revert", "S4 invalid signature");
  nonce--; // the forged round consumed no nonce

  const outsider = privateKeyToAccount("0x" + "11".repeat(32));
  let unauth = await signRound([2500, 2500, 2500], ++nonce, [sources[0], sources[1], outsider].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)));
  await submit("Round including a signer that is not an authorised source", unauth, "revert", "S4 unauthorized signer");
  nonce--;

  let dup = await signRound([2500, 2500, 2500]);
  dup.atts[2] = dup.atts[1]; dup.sigs[2] = dup.sigs[1];
  await submit("Same source counted twice to fake a quorum", dup, "revert", "S4 duplicate source");
  nonce--;

  let r2 = await signRound([2500, 2500, 2500]);
  await submit("Valid round #2", r2, "success");
  await submit("REPLAY of round #2 (same signatures, same nonce)", r2, "revert", "S5 replay");

  // ==================================================================================== ACT 3
  await pause();
  title("ACT 3 — Sources disagree → DISPUTED → new debt blocked, repay allowed, recovery  [S3, S8, S7]");
  let r3 = await signRound([1500, 2500, 2510]);
  await submit("Round #3: sources disagree (1500 / 2500 / 2510) — recorded as DISPUTED", r3, "success");
  const s3 = await state("after disputed round");
  check("S3 divergent sources", "Verifier status is DISPUTED", s3.asoStatus === 3, STATUS[s3.asoStatus]);
  await poke("Keeper: ASOSentinel.poke() → ASO_DISPUTED, line := 0");
  await deposit(bob, "Bob", "protected", 10n * WAD);
  await borrow(bob, "Bob", "protected", 1_000n * WAD, "revert", "S3 divergent sources");
  await repay(alice, "Alice", "protected", 20_000n * WAD, "success", "S8 repay while restricted");
  let r4 = await signRound([2500, 2500, 2500]);
  await submit("Round #4: sources agree again", r4, "success");
  await poke("Keeper: ASOSentinel.poke() → HEALTHY (new round after incident) → reopens");
  await borrow(bob, "Bob", "protected", 1_000n * WAD, "success", "S7 recovery");

  // ==================================================================================== ACT 4
  await pause();
  title("ACT 4 — Multipli OSM staleness gap: BASELINE vs PROTECTED  [S6, S2]");
  note("Market falls to $1,500. The Chainlink-style feeder stops updating (no transaction).");
  let r5 = await signRound([1500, 1500, 1499]);
  await submit("Round #5: independent sources attest $1,500", r5, "success");
  const s4 = await state("feeder frozen at $2,500, real price $1,500");
  check("S6 feeder stops", "Multipli OSM still serves the frozen $2,500 as valid", s4.osmHas && s4.osmVal === 2500n * WAD, `OSM ${formatUnits(s4.osmVal, 18)} has=${s4.osmHas}`);

  for (const sys of ["baseline", "protected"]) await deposit(mallory, "Mallory", sys, 100n * WAD);
  await borrow(mallory, "Mallory", "baseline", 178_000n * WAD, "success", "S6 baseline is vulnerable");
  note("Mallory's 100 mPAXG are worth $150,000 at the real price, against 178,000 rwaUSD of debt → ~$28,000 bad debt on BASELINE");
  await poke("Keeper: ASOSentinel.poke() → VAT_PRICE_ABOVE_ATTESTED, line := 0");
  await borrow(mallory, "Mallory", "protected", 178_000n * WAD, "revert", "S6 protected blocks");

  note("Everything goes silent for 25 hours: no feeder updates, no attestations.");
  let expired = await signRound([1500, 1500, 1500]); // signed now, submitted after it expires
  await warp(25n * HOUR);
  await tx("Anyone: OSM.poke() (adapter is stale → OSM silently keeps its old value)", keeper, D.osm, A.osm, "poke", []);
  await tx("Anyone: Spotter.poke (baseline)", keeper, D.baselineSpotter, A.spot, "poke", [ILK]);
  const s5 = await state("25h of silence");
  check("S6 feeder stops", "Multipli adapter reports stale, yet OSM still says has=true", !s5.adapterOk && s5.osmHas, `adapter=${s5.adapterOk} osm.has=${s5.osmHas}`);
  check("S2 stale", "ASO verifier status is STALE without any transaction", s5.asoStatus === 2, STATUS[s5.asoStatus]);
  await submit("Relayer submits a round whose attestations expired", expired, "revert", "S2 expired attestation");
  nonce--;
  await deposit(bob, "Bob", "baseline", 10n * WAD);
  await borrow(bob, "Bob", "baseline", 5_000n * WAD, "success", "S6 baseline lends on 25h-old price");
  await poke("Keeper: ASOSentinel.poke() → ASO_STALE, line stays 0");
  await borrow(bob, "Bob", "protected", 1_000n * WAD, "revert", "S2 stale blocks borrowing");
  await repay(alice, "Alice", "protected", 10_000n * WAD, "success", "S8 repay while restricted");

  // ==================================================================================== ACT 5
  await pause();
  title("ACT 5 — Recovery only after fresh, valid, agreeing data  [S7]");
  await tx("Feeder resumes: MockAggregator.setAnswer($1,500)", feeder, D.feed, A.feed, "setAnswer", [1500n * 10n ** 8n]);
  note("Two OSM hops so the OSM passes the new price through");
  await osmHop();
  await osmHop();
  const r6pre = await poke("Keeper: poke BEFORE a new round → still closed");
  const s6 = await state("feed + OSM recovered, no new attestation yet");
  check("S7 recovery", "Borrowing stays closed until a new attested round", s6.pLine === 0n, `line=${s6.pLine}`);
  let r6 = await signRound([1500, 1501, 1500]);
  await submit("Round: fresh sources agree on $1,500", r6, "success");
  await poke("Keeper: ASOSentinel.poke() → HEALTHY → line := debt + gap");
  await borrow(bob, "Bob", "protected", 1_000n * WAD, "success", "S7 recovery");
  await state("recovered at the real price");

  // ==================================================================================== summary
  await pause();
  title("RESULTS (expected vs actual, from mined transactions)");
  let allPass = true;
  for (const r of results) {
    allPass &&= r.pass;
    log(`   ${r.pass ? C.g + "PASS" : C.r + "FAIL"}${C.x}  ${r.scenario.padEnd(36)} ${C.d}${r.actual}${C.x}`);
  }
  log(`\n   ${allPass ? C.g + C.b + "ALL SCENARIOS BEHAVED AS EXPECTED" : C.r + C.b + "SOME SCENARIOS DID NOT BEHAVE AS EXPECTED"}${C.x} (${results.length} checks)`);
  return allPass;
}

main()
  .then((ok) => { rl?.close(); anvil?.kill(); process.exit(ok ? 0 : 1); })
  .catch((e) => { console.error(e); anvil?.kill(); process.exit(1); });
