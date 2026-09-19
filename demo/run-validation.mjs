// Origin // ASO Sentinel — validation runner.
//
//   cd demo && npm run validate                        final (deployed default) rules, main + holdout, then the report
//   npm run validate -- --rules=baseline               original rules (vatCheck = CONSERVATIVE, set explicitly)
//   npm run validate -- --rules=candidate-graded       the evaluated-and-rejected alternative (vatCheck = GRADED)
//   npm run validate -- --suite=holdout                one suite only (main | holdout | all)
//   npm run validate -- --only=A1,S3                   a subset; prints results, writes nothing
//   npm run validate -- --check                        fail if any outcome differs from the committed file
//   npm run validate -- --report                       only regenerate docs/VALIDATION.md from the result files
//
// Results: validation/<baseline|candidate-graded|final>/<main|holdout>.json. A rules/suite pair only overwrites its own file,
// so the baseline is never replaced by final-rule results. Fresh LOCAL anvil chain only (public test keys).
// Exit 1 on: a harness error, an invariant or transition violation, or (--check) a changed outcome.
// False positives / false negatives are FINDINGS and do not fail the run.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createOrigin, CONCERN } from "../shared/origin-core.mjs";
import { CASES, HOLDOUT, runCase, summarize } from "../shared/validation.mjs";
import { HISTORICAL } from "../shared/historical.mjs";
import { ANALYSIS, RULE_CHANGE } from "../shared/analysis.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "validation");
const OUT_MD = join(ROOT, "docs", "VALIDATION.md");
const PORT = 8548;
const RPC = `http://127.0.0.1:${PORT}`;
const START_TS = 1_800_000_000;
const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const only = arg("only", "").split(",").filter(Boolean);
const rules = arg("rules", "final");
const suite = arg("suite", "all");
const check = args.includes("--check");
const reportOnly = args.includes("--report");
const RULESETS = {
  baseline: { mode: 0, set: true, text: "original rules: Vat price must stay within 2% of min(attested, TWAP) (CONSERVATIVE), set explicitly" },
  "candidate-graded": { mode: 1, set: true, text: "evaluated alternative: Vat vs attested + 2% → PROTECTIVE; Vat vs TWAP beyond the 3% watch band → WATCH (GRADED)" },
  final: { mode: 0, set: false, text: "final rules = the contract's deployed default (CONSERVATIVE); nothing set after deploy" },
};
if (!RULESETS[rules]) throw new Error("--rules must be baseline, candidate-graded or final");
if (!["main", "holdout", "all"].includes(suite)) throw new Error("--suite must be main, holdout or all");

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", d: "\x1b[2m", x: "\x1b[0m" };
const log = (...a) => console.log(...a);
function bin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : name;
}
const sh = (cmd, a) => { const r = spawnSync(cmd, a, { cwd: ROOT, encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
const file = (r, s) => join(OUT_DIR, r, `${s}.json`);
const load = (r, s) => (existsSync(file(r, s)) ? JSON.parse(readFileSync(file(r, s), "utf8")) : null);

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
const stop = () => { try { anvil?.kill(); } catch { /* already gone */ } };
process.on("exit", stop);

const fmtD = (s) => (s == null ? "—" : s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const wad = (x) => Number(BigInt(x) / 10n ** 14n) / 1e4;
const rad = (x) => Number(BigInt(x) / 10n ** 41n) / 1e4;

async function main() {
  if (reportOnly) { writeReport(); return; }
  const t0 = Date.now();
  log(`${C.b}${C.c}━━ Origin validation · rules=${rules} · suite=${suite} (local anvil :${PORT}) ━━${C.x}`);
  anvil = spawn(bin("anvil"), ["--port", String(PORT), "--timestamp", String(START_TS), "--silent"], { stdio: "ignore" });
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  for (let i = 0; i < 100; i++) { try { await publicClient.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const dep = spawnSync(bin("forge"), ["script", "script/DeployOrigin.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: ROOT, encoding: "utf8" });
  if (dep.status !== 0) { log(dep.stdout, dep.stderr); throw new Error("forge script DeployOrigin failed"); }
  const D = JSON.parse(readFileSync(join(ROOT, "deployments", "31337-origin.json"), "utf8"));
  const abis = JSON.parse(readFileSync(join(ROOT, "shared", "abis.json"), "utf8"));
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const walletFor = (account) => createWalletClient({ account, chain: foundry, transport: http(RPC) });
  let unexpected = [];
  const o = createOrigin({ publicClient, testClient, walletFor, deployment: D, abis, accounts: ACCOUNTS, onTx: (r) => { if (!r.pass) unexpected.push(r); } });

  // rule set under test: set on the deployed contract before anything else happens
  const rs = RULESETS[rules];
  if (rs.set) await o.tx(`setVatCheck(${rs.mode})`, ACCOUNTS.admin, D.sentinel, abis.sentinel, "setVatCheck", [rs.mode], { strict: true, quiet: true });
  const vatCheck = Number(await o.read(D.sentinel, abis.sentinel, "vatCheck"));
  if (vatCheck !== rs.mode) throw new Error(`vatCheck is ${vatCheck}, expected ${rs.mode} for ${rules}`);

  await o.bootstrap();
  if ((await o.readState()) !== 0) throw new Error("bootstrap did not reach FRESH");
  const r0 = await o.readAll();
  let snap = await testClient.snapshot();
  const config = await readConfig(o, D, abis, r0, vatCheck);

  const suites = suite === "all" ? ["main", "holdout"] : [suite];
  let failed = false;
  for (const sname of suites) {
    const defs = (sname === "main" ? CASES : HOLDOUT).filter((c) => !only.length || only.includes(c.id));
    if (!defs.length) continue;
    log(`\n${C.b}   ${sname.toUpperCase()} suite (${defs.length} cases)${C.x}`);
    const results = [];
    const ts = Date.now();
    for (const def of defs) {
      await testClient.revert({ id: snap });
      snap = await testClient.snapshot();
      unexpected = [];
      process.stdout.write(`   ${def.id.padEnd(4)} ${def.title.slice(0, 56).padEnd(56)} `);
      const res = await runCase(o, def);
      if (unexpected.length) res.harnessNotes = unexpected.map((u) => `${u.label}: ${u.status ?? u.actual}${u.reason ? ` (${u.reason})` : ""}`);
      results.push(res);
      const col = ["TP", "TN", "MATCH"].includes(res.outcome) ? C.g : C.y;
      log(`${col}${res.outcome.padEnd(8)}${C.x} ${String(res.actual.finalState).padEnd(10)} ${res.pass ? `${C.g}pass${C.x}` : `${C.y}miss${C.x}`} ${C.d}${res.latencyNote ?? ""}${res.error ? ` ERROR: ${res.error}` : ""}${C.x}`);
    }
    const summary = summarize(results);
    const out = {
      meta: {
        rules, ruleDescription: rs.text,
        suite: sname, generatedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - ts) / 1000),
        gitCommit: sh("git", ["rev-parse", "--short", "HEAD"]), workingTreeClean: sh("git", ["status", "--porcelain"]) === "",
        forge: sh(bin("forge"), ["--version"])?.split("\n")[0] ?? null,
        network: "local anvil (chain id 31337) — synthetic prices, anvil test keys",
        command: `cd demo && npm run validate -- --rules=${rules} --suite=${sname}`,
      },
      config, summary, cases: results,
    };
    if (sname === "main") out.sensitivity = await sensitivity(o, r0);
    const s = summary;
    log(`   N = ${s.total} (${s.risk} risk · ${s.healthy} healthy · ${s.degraded} degraded) · TP ${s.TP} · FN ${s.FN} · TN ${s.TN} · FP ${s.FP} · degraded ${s.degradedMatch}/${s.degraded}`);
    log(`   precision ${pct(s.precision)} · recall ${pct(s.recall)} · FPR ${pct(s.falsePositiveRate)} · invariants ${s.invariantChecks} (${s.invariantViolations} violations) · transitions ${s.transitions} (${s.transitionViolations} violations) · errors ${s.errors}`);
    if (s.errors + s.invariantViolations + s.transitionViolations) failed = true;

    if (check) {
      const prev = load(rules, sname);
      const by = Object.fromEntries((prev?.cases ?? []).map((c) => [c.id, c]));
      const changed = results.filter((r) => by[r.id] && (by[r.id].outcome !== r.outcome || by[r.id].actual.finalState !== r.actual.finalState));
      if (changed.length) { failed = true; log(`${C.r}   changed vs committed:${C.x} ${changed.map((r) => `${r.id} ${by[r.id].outcome}/${by[r.id].actual.finalState} → ${r.outcome}/${r.actual.finalState}`).join(", ")}`); }
    }
    if (!only.length) {
      mkdirSync(join(OUT_DIR, rules), { recursive: true });
      writeFileSync(file(rules, sname), JSON.stringify(out, null, 1) + "\n");
      log(`   wrote validation/${rules}/${sname}.json`);
    }
  }
  if (!only.length) writeReport();
  log(`\n   total ${Math.round((Date.now() - t0) / 1000)} s`);
  if (failed) { log(`${C.r}${C.b}   VALIDATION RUN FAILED${C.x}`); process.exit(1); }
  log(`${C.g}${C.b}   VALIDATION RUN COMPLETE${C.x} ${C.d}(FP/FN are findings, not harness failures)${C.x}`);
  process.exit(0);
}

async function readConfig(o, D, abis, r0, vatCheck) {
  const [thr, lim, ep] = [r0.thresholds, r0.limits, r0.epochConfig];
  return {
    vatCheck: vatCheck === 0 ? "CONSERVATIVE" : "GRADED",
    quorum: Number(r0.verifier.quorum), sources: ACCOUNTS.sources.length, maxAgeSeconds: Number(r0.verifier.maxAge),
    maxDeviationBps: Number(await o.read(D.verifier, abis.verifier, "maxDeviationBps")),
    twapWindowSeconds: Number(r0.risk.twapWindow), twapMinCoverageBps: Number(r0.risk.minCoverage),
    twapWatchBps: Number(thr[0]), twapProtectBps: Number(thr[1]), velocityWatchBpsPerHour: Number(thr[2]), velocityProtectBpsPerHour: Number(thr[3]),
    sourceDivergenceBps: Number(thr[4]), recoveryDelaySeconds: Number(thr[5]),
    gapRwa: rad(lim[1]), maxLineRwa: rad(lim[0]), watchGapBps: Number(lim[2]), maxPriceGapBps: Number(lim[3]),
    epochSeconds: Number(ep[0]), epochGrowthCapRwa: rad(ep[1]),
    depthUsdPer1Pct: wad(r0.risk.depth), lossShareBps: Number(r0.risk.lossShare), elevatedRatioBps: Number(r0.risk.elevatedRatio), highRatioBps: Number(r0.risk.highRatio),
    matPct: Number(r0.matRay / 10n ** 23n) / 100,
  };
}

// every point from the deployed ASORiskEngine.quote()
async function sensitivity(o, r0) {
  const freshH = Number(r0.snapshot.freshHeadroom / 10n ** 45n);
  const baseH = Number(r0.baseline.headroomWad / 10n ** 18n);
  const out = { depths: [1_000, 25_000, 250_000], deviationsBps: [500, 1500, 3000, 6000, 7000, 10000], headrooms: [freshH, baseH], points: [], verdicts: [] };
  for (const depth of out.depths) for (const H of out.headrooms) {
    for (const d of out.deviationsBps) {
      const q = (await o.quote(depth, H, d)).quote;
      out.points.push({ depth, headroom: H, deviationBps: d, capitalUsd: wad(q.capitalUsd), costUsd: wad(q.costUsd), extractableUsd: wad(q.extractableUsd), ratio: q.ratioBps >= 2n ** 255n ? null : Number(q.ratioBps) / 10_000 });
    }
    const best = await o.quote(depth, H, 500);
    out.verdicts.push({ depth, headroom: H, verdict: CONCERN[best.concern], bestDeviationBps: Number(best.best.deviationBps), bestRatio: best.best.ratioBps >= 2n ** 255n ? null : Number(best.best.ratioBps) / 10_000 });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ report

function writeReport() {
  const R = { bm: load("baseline", "main"), bh: load("baseline", "holdout"), gm: load("candidate-graded", "main"), gh: load("candidate-graded", "holdout"), fm: load("final", "main"), fh: load("final", "holdout") };
  if (!R.fm && !R.bm) { log("   no result files yet — nothing to report"); return; }
  writeFileSync(OUT_MD, renderMarkdown(R));
  log(`   wrote docs/VALIDATION.md`);
}

const row = (a) => `| ${a.join(" | ")} |`;
const SETS = (R) => [["baseline/main", R.bm], ["baseline/holdout", R.bh], ["candidate-graded/main", R.gm], ["candidate-graded/holdout", R.gh], ["final/main", R.fm], ["final/holdout", R.fh]];
const money = (x) => (x == null ? "—" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(0)}`);

function metricsRow(label, f) {
  if (!f) return row([label, "not run", "", "", "", "", "", "", "", ""]);
  const s = f.summary;
  return row([label, `${s.total} (${s.risk}/${s.healthy}/${s.degraded})`, s.TP, s.FN, s.TN, s.FP, pct(s.recall), pct(s.precision), pct(s.falsePositiveRate), `${s.healthyRestrictedPokes}/${s.healthyPokes} (${s.healthyBlockedPokes} blocked)`]);
}

function caseTable(list) {
  return [
    row(["ID", "Case", "Truth", "Sources online · manipulated", "Expected (policy)", "Actual final state (states seen)", "Borrow probe (final)", "Outcome", "Latency"]),
    row(Array(9).fill("---")),
    ...list.map((c) => row([c.id, c.title, c.truth, `${c.sources.online}/5 · ${c.sources.manipulated}`, c.expected, `${c.actual.finalState} (${c.actual.statesSeen.join(" → ")})`,
      c.actual.borrowProbeFinal == null ? "—" : c.actual.borrowProbeFinal ? "would succeed" : "would revert", c.outcome, c.required === "reject" ? "same tx" : fmtD(c.latencySeconds)])),
  ].join("\n");
}

function analysisBlock(c, other) {
  const a = ANALYSIS[c.id] ?? {};
  const signals = c.outcome === "FP" ? c.restriction?.causes ?? [] : [...new Set(c.observations.flatMap((x) => x.flags))];
  const lines = [
    `#### ${c.id} — ${c.title} (${c.outcome})`,
    "",
    `- **Scenario:** ${c.description}`,
    `- **Ground truth:** ${c.truth}`,
    `- **${c.outcome === "FP" ? "Triggered" : "Observed"} signals:** ${signals.length ? signals.join(", ") : "none"}`,
    `- **States entered:** ${c.actual.statesSeen.join(" → ")} (final ${c.actual.finalState})${c.restriction ? `; restricted at ${c.restriction.pokes} of ${c.restriction.of} pokes, ${c.restriction.blockedPokes} fully blocked` : ""}`,
  ];
  if (other) lines.push(`- **Other rule set:** ${other.outcome}, final ${other.actual.finalState}${other.restriction ? `, ${other.restriction.blockedPokes} blocked pokes` : ""}`);
  if (a.why) lines.push(`- **Why:** ${a.why}`);
  if (a.appropriate) lines.push(`- **${c.outcome === "FP" ? "Was the restriction appropriate?" : "Security implication"}** ${a.appropriate}`);
  if (a.mitigation) lines.push(`- **${c.outcome === "FP" ? "Potential mitigation" : "Possible future improvement"}:** ${a.mitigation}`);
  return lines.join("\n");
}

function reproSection(a, b, name) {
  if (!a || !b) return `- ${name}: not both runs available.`
  const diffs = a.cases.map((c) => [c, b.cases.find((x) => x.id === c.id)]).filter(([c, x]) => !x || x.outcome !== c.outcome || x.actual.finalState !== c.actual.finalState || x.actual.statesSeen.join() !== c.actual.statesSeen.join());
  const outcomeDiffs = diffs.filter(([c, x]) => !x || x.outcome !== c.outcome || x.actual.finalState !== c.actual.finalState);
  return `- **${name} suite:** ${a.cases.length} cases compared; outcome or final state differs in **${outcomeDiffs.length}**; the per-poke state sequence differs in **${diffs.length}**${diffs.length ? ` (${diffs.map(([c, x]) => `${c.id}: ${c.actual.statesSeen.join("→")} vs ${x?.actual.statesSeen.join("→")}`).join("; ")})` : ""}.`
}

function renderMarkdown({ bm, bh, gm, gh, fm, fh }) {
  const f = fm ?? bm;
  const k = f.config;
  const sens = f.sensitivity ?? bm?.sensitivity;
  const other = (c, set) => set?.cases.find((x) => x.id === c.id);
  const fpfn = (res, alt) => (res ? res.cases.filter((c) => c.outcome === "FP" || c.outcome === "FN").map((c) => analysisBlock(c, other(c, alt))).join("\n\n") || "_None._" : "_Not run._");
  const groups = [...new Set(f.cases.map((c) => c.group))];
  return `# Validation report

> **Generated file — do not edit by hand.** Every number comes from the result files in \`validation/\`, produced by
> \`cd demo && npm run validate\` against the real contracts on a local anvil chain (synthetic prices, anvil test keys).
>
> | Result file | Rules | Generated | Commit |
> |---|---|---|---|
${SETS({ bm, bh, gm, gh, fm, fh }).map(([n, x]) => `> | \`validation/${n}.json\` | ${x ? x.meta.rules : "—"} | ${x ? x.meta.generatedAt : "not run"} | ${x ? `\`${x.meta.gitCommit}\`${x.meta.workingTreeClean ? "" : " + uncommitted changes"}` : "—"} |`).join("\n")}

## 1. Summary — baseline vs final

| Result set | N (risk/healthy/degraded) | TP | FN | TN | FP | Recall | Precision | FP rate | Healthy pokes restricted |
|---|---|---|---|---|---|---|---|---|---|
${metricsRow("**Baseline rules — main suite**", bm)}
${metricsRow("Baseline rules — holdout suite", bh)}
${metricsRow("Candidate GRADED rule (rejected) — main", gm)}
${metricsRow("Candidate GRADED rule (rejected) — holdout", gh)}
${metricsRow("**Final rules — main suite**", fm)}
${metricsRow("Final rules — holdout suite", fh)}

The **baseline** is the original rule set and is never overwritten (the first baseline run is also archived unchanged in
\`validation/baseline/main.frozen-original.json\`). One alternative rule was evaluated and **rejected** (§2), so the **final**
rules are the baseline rules; the final run re-executes them on the finished contract code to show the added code changed no outcome.
Safety invariants and transition rules were checked at every poke in every run:
${SETS({ bm, bh, gm, gh, fm, fh }).filter(([, x]) => x).map(([n, x]) => `${n}: ${x.summary.invariantChecks} invariant checks, ${x.summary.invariantViolations} violations; ${x.summary.transitions} transitions, ${x.summary.transitionViolations} violations`).join(" · ")}.

**What these numbers are — and are not.** They describe behaviour on hand-built synthetic scenarios run against the real
contracts. They are not real-world detection rates: the scenarios, prices and thresholds were chosen by the team, sources are
test keys and market depth is an assumption. Several cases were included because we expected the design to miss them.

## 2. The one candidate rule change, and why it was rejected

${RULE_CHANGE}

## 3. Methodology

Every case starts from the same healthy snapshot (Sentinel FRESH, Alice 50,000 rwaUSD debt on both markets), performs real
transactions, and calls the permissionless \`poke()\` after every price event. After each poke the harness records state, flags
and debt ceiling and probes with \`eth_call\` (nothing mined) whether a 1,000 rwaUSD borrow and repayment would succeed on the
protected Vat, and whether the borrow would succeed on the unprotected baseline Vat.

| Truth | Meaning | Correct outcome |
|---|---|---|
| risk | attack or oracle failure present | required protection reached (**limited** = WATCH or stricter, **blocked** = ceiling 0) and not lapsed back to unrestricted while the risk persists; invalid data rejected by the verifier |
| healthy | honest market and sources | never restricted (WATCH counts as a restriction) |
| degraded | sources partly unavailable | documented degraded policy (3/5 → WATCH) |

TP/FN on risk cases, TN/FP on healthy cases. Precision = TP/(TP+FP), recall = TP/(TP+FN), FP rate = FP/(FP+TN). Latency is
chain time from the case's ground-truth onset to the first poke meeting the required protection (pokes follow every price
event, so keeper delay is excluded). Invariants at every poke: the poke never changes the Vat's collateral price; restricted ⇒
ceiling 0; ceiling = \`policyLine(state)\`; a repayment would succeed; a borrow would revert when restricted. Transition rule:
DISPUTED/PROTECTIVE never go straight to FRESH/WATCH; RECOVERING opens only after a newer accepted round and the delay.

The **holdout suite** (\`HOLDOUT\` in \`shared/validation.mjs\`) was written before the rule change, uses magnitudes and shapes that
do not appear in the main suite, and was not used to choose the change — only to measure it.

## 4. Configuration under test (read from the deployed contracts)

| Parameter | Value |
|---|---|
| Quorum | ${k.quorum} of ${k.sources}, agreement within ${k.maxDeviationBps / 100}% |
| Attestation max age | ${fmtD(k.maxAgeSeconds)} |
| TWAP window / minimum coverage | ${fmtD(k.twapWindowSeconds)} / ${k.twapMinCoverageBps / 100}% |
| TWAP watch / protect | ${k.twapWatchBps / 100}% / ${k.twapProtectBps / 100}% |
| Velocity watch / protect | ${k.velocityWatchBpsPerHour / 100}%/h / ${k.velocityProtectBpsPerHour / 100}%/h |
| Vat price tolerance | ${k.maxPriceGapBps / 100}% |
| Recovery delay | ${fmtD(k.recoveryDelaySeconds)} |
| Gap / WATCH share / max line | ${k.gapRwa.toLocaleString("en-US")} / ${k.watchGapBps / 100}% / ${k.maxLineRwa.toLocaleString("en-US")} rwaUSD |
| Epoch / growth cap | ${fmtD(k.epochSeconds)} / ${k.epochGrowthCapRwa.toLocaleString("en-US")} rwaUSD |
| Depth assumption (default) | $${k.depthUsdPer1Pct.toLocaleString("en-US")} per 1% — governance assumption, not measured |
| Loss share / ELEVATED / HIGH | ${k.lossShareBps / 100}% / ${k.elevatedRatioBps / 10_000}× / ${k.highRatioBps / 10_000}× |
| Liquidation ratio (mat) | ${k.matPct}% |

## 5. Main suite — final rules

${groups.map((g) => `### ${g}\n\n${caseTable(f.cases.filter((c) => c.group === g))}`).join("\n\n")}

${fh ? `## 6. Holdout suite — final rules\n\n${caseTable(fh.cases)}` : "## 6. Holdout suite\n\n_Not run._"}

## 7. False positives and false negatives, case by case

### Final rules — main suite

${fpfn(fm, gm)}

### Final rules — holdout suite

${fpfn(fh, gh)}

The baseline rules are identical to the final rules (§2), so their FP/FN analysis is the same; their raw results are in \`validation/baseline/\`. "Other rule set" in each entry above is the rejected GRADED candidate's outcome for the same case.

## 8. Known detection boundaries

These are limits of what Origin claims, not hidden failures:

1. **Long-duration manipulation can enter the TWAP.** A price held longer than the ${fmtD(k.twapWindowSeconds)} window stops looking like a deviation (A4). The epoch cap and WATCH headroom bound exposure; they do not detect it.
2. **Small manipulation stays below thresholds.** Moves under ${k.twapWatchBps / 100}% (and under ${k.velocityWatchBpsPerHour / 100}%/h) are not flagged (A6). At a ${k.matPct}% liquidation ratio such moves cannot create bad debt on their own.
3. **The cost gate depends on the depth assumption.** It is only as good as governance's market-depth input.
4. **A compromised source majority passes the verifier.** Only the economic layer can object (V3–V5), and only when the move is large or fast enough.
5. **Demo sources are controlled test keys**, not independent data providers.
6. **Prototype:** not audited, not integrated with Multipli; liquidations and collateral withdrawal are outside its scope.

## 9. Manipulation-cost methodology (as implemented in \`src/risk/CostModel.sol\`)

\`\`\`
d               price inflation the attacker aims for (fraction)
D               governance depth ASSUMPTION: USD that moves the price by 1%   (default $${k.depthUsdPer1Pct.toLocaleString("en-US")})
H               new debt the attacker could take now = the Sentinel's FRESH headroom
mat             liquidation ratio (${k.matPct}%)
lossShare       assumed share of (capital × move) lost unwinding the position (${k.lossShareBps / 100}%)

capital(d)      = D × (d in %)
cost(d)         = capital(d) × d × lossShare
extractable(d)  = H × max(0, 1 − mat / (1 + d))
ratio           = cost / extractable at d0 + 5, 15, 30, 60 points (d0 = mat − 1, the minimum profitable inflation); the lowest ratio decides
LOW ≥ ${k.elevatedRatioBps / 10_000}× · ELEVATED ${k.highRatioBps / 10_000}–${k.elevatedRatioBps / 10_000}× (→ WATCH) · HIGH < ${k.highRatioBps / 10_000}× (→ PROTECTIVE) · no/stale depth → INSUFFICIENT DATA (→ WATCH)
\`\`\`

Note that cost includes the factor d: the attacker's modelled loss grows with both the capital deployed and the size of the move.
This is a simplified economic proxy. It does not model order books, multiple venues, flash loans, MEV, cross-venue arbitrage,
liquidation cascades or non-linear slippage. A LOW verdict means *under the stated assumptions, the modelled attack cost exceeds
the modelled extractable value* — not that an attack is impossible.

## 10. Sensitivity analysis (every point from \`ASORiskEngine.quote()\`)

${sens ? `| Depth $/1% | Headroom H | d | Capital | Cost | Extractable | Cost / extractable |
|---|---|---|---|---|---|---|
${sens.points.map((p) => `| $${p.depth.toLocaleString("en-US")} | ${p.headroom.toLocaleString("en-US")} | +${p.deviationBps / 100}% | ${money(p.capitalUsd)} | ${money(p.costUsd)} | ${money(p.extractableUsd)} | ${p.ratio == null ? "∞ (nothing extractable)" : `${p.ratio.toFixed(2)}×`} |`).join("\n")}

| Depth $/1% | Headroom H | Gate verdict | Most attractive d | Ratio |
|---|---|---|---|---|
${sens.verdicts.map((p) => `| $${p.depth.toLocaleString("en-US")} | ${p.headroom.toLocaleString("en-US")} | ${p.verdict} | +${p.bestDeviationBps / 100}% | ${p.bestRatio == null ? "∞" : `${p.bestRatio.toFixed(2)}×`} |`).join("\n")}

Headroom ${sens.headrooms[0].toLocaleString("en-US")} is the Sentinel's bounded FRESH headroom; ${sens.headrooms[1].toLocaleString("en-US")} is the unprotected baseline's remaining capacity.` : "_Not run._"}

## 11. Historical validation

${HISTORICAL.map((h) => `### ${h.name} (${h.date})

- **Historical fact:** ${h.facts.join(" ")}
- **Sources:** ${h.sources.map((x) => `[${x.label}](${x.url})`).join("; ")}
- **Retrospective mapping (our interpretation):** ${h.mapping}
- **Reproduced pattern (synthetic):** ${h.reproduced.map((id) => { const c = f.cases.find((x) => x.id === id); return c ? `${id} (${c.outcome}, final ${c.actual.finalState})` : id; }).join(", ")}
- **Not modeled:** ${h.notModeled}`).join("\n\n")}

No historical market data is replayed, and no claim is made that Origin would have prevented any of these incidents.

## 12. Reproducibility check

${reproSection(bm, fm, "main")}
${reproSection(bh, fh, "holdout")}

Baseline and final use identical rules, so these two runs measure run-to-run reproducibility. anvil's block timestamps advance
with a few seconds of wall-clock time between transactions; a case whose price sits exactly on a threshold can therefore flip
the state of an individual poke between runs. \`--check\` compares outcome and final state, which is what the metrics use.

## 13. Reproduce

\`\`\`bash
forge build
cd demo && npm ci
npm run validate                                   # final rules (deployed default), main + holdout
npm run validate -- --rules=baseline               # original rules, main + holdout
npm run validate -- --rules=candidate-graded       # the evaluated, rejected alternative
npm run validate -- --report                       # regenerate this file from validation/*.json
\`\`\`
`;
}

main().catch((e) => { console.error(`\n${C.r}✖ ${e.stack ?? e.message}${C.x}`); stop(); process.exit(1); });
