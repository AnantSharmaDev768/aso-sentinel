// One-command local dashboard: fresh anvil chain → forge script DeployOrigin → bootstrap to the healthy
// FRESH state with real transactions → evm snapshot (for the dashboard's Reset button) → Vite dev server.
// Local only: anvil's PUBLIC test keys, chain id 31337. Nothing here touches a public network.
//
//   cd app && npm run local            (add --no-serve to deploy + bootstrap and exit)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createOrigin, LOCAL_CHAIN_ID, STATE } from "../../shared/origin-core.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(APP, "..");
const PORT = Number(process.env.ANVIL_PORT ?? 8545);
const RPC = `http://127.0.0.1:${PORT}`;
const START_TS = 1_800_000_000; // matches the dashboard's chain-time display origin
const serve = !process.argv.includes("--no-serve");

function bin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : name;
}

// anvil PUBLIC test keys — local only, never real funds
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

const children = [];
const shutdown = (code) => { for (const c of children) c.kill(); process.exit(code); };
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  try {
    await publicClient.getChainId();
    throw new Error(`Something is already listening on ${RPC}. Stop it (or set ANVIL_PORT and VITE_RPC_URL) and retry.`);
  } catch (e) {
    if (String(e.message).startsWith("Something")) throw e;
  }

  console.log(`▸ starting anvil on ${RPC}`);
  const anvil = spawn(bin("anvil"), ["--port", String(PORT), "--timestamp", String(START_TS), "--silent"], { stdio: "ignore" });
  children.push(anvil);
  anvil.on("exit", (c) => { if (c) { console.error(`anvil exited with code ${c}`); shutdown(1); } });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await publicClient.getChainId()) === LOCAL_CHAIN_ID; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) throw new Error("anvil did not start (is Foundry installed?)");

  console.log("▸ forge script script/DeployOrigin.s.sol");
  const r = spawnSync(bin("forge"), ["script", "script/DeployOrigin.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error("forge script DeployOrigin failed"); }
  const D = JSON.parse(readFileSync(join(ROOT, "deployments", "31337-origin.json"), "utf8"));

  console.log("▸ bootstrapping to the healthy state (real transactions)");
  const abis = JSON.parse(readFileSync(join(ROOT, "shared", "abis.json"), "utf8"));
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const walletFor = (account) => createWalletClient({ account, chain: foundry, transport: http(RPC) });
  let failed = 0;
  const o = createOrigin({
    publicClient, testClient, walletFor, deployment: D, abis, accounts: ACCOUNTS,
    onTx: (t) => { if (!t.pass) { failed++; console.error(`  ✖ ${t.label}: ${t.actual ?? t.reason ?? t.status}`); } },
  });
  await o.bootstrap();
  const state = STATE[await o.readState()];
  if (failed || state !== "FRESH") throw new Error(`bootstrap did not reach FRESH (state ${state}, ${failed} unexpected outcomes)`);

  const snapshotId = await testClient.snapshot();
  const out = { ...D, snapshotId, deployedAt: new Date().toISOString(), rpcUrl: RPC };
  writeFileSync(join(APP, "public", "deployment.local.json"), JSON.stringify(out, null, 2));
  console.log(`✔ Sentinel FRESH · snapshot ${snapshotId} · wrote app/public/deployment.local.json`);

  if (!serve) shutdown(0);
  console.log("▸ starting the dashboard (Ctrl+C stops the dashboard and the chain)");
  const vite = spawn(process.execPath, [join(APP, "node_modules", "vite", "bin", "vite.js")], {
    cwd: APP, stdio: "inherit", env: { ...process.env, VITE_RPC_URL: RPC },
  });
  children.push(vite);
  vite.on("exit", (c) => shutdown(c ?? 0));
}

main().catch((e) => { console.error(`\n✖ ${e.message}`); shutdown(1); });
