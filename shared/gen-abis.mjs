// Extracts the ABIs the demo and dashboard need from Foundry's build output into shared/abis.json.
// Run after `forge build`:   node shared/gen-abis.mjs
// The generated file is committed so the dashboard can build without Foundry; `--check` fails if stale.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = {
  vat: ["vat.sol", "Vat"],
  spot: ["spot.sol", "Spotter"],
  osm: ["osm.sol", "OSM"],
  adapter: ["adapter.sol", "PriceFeedAdapter"],
  join: ["join.sol", "GemJoin5"],
  verifier: ["ASOVerifier.sol", "ASOVerifier"],
  riskEngine: ["ASORiskEngine.sol", "ASORiskEngine"],
  sentinel: ["OriginSentinel.sol", "OriginSentinel"],
  feed: ["MockAggregator.sol", "MockAggregator"],
  gem: ["MockRWA.sol", "MockRWA"],
};

const out = {};
for (const [key, [file, name]] of Object.entries(SOURCES)) {
  const p = join(ROOT, "out", file, `${name}.json`);
  if (!existsSync(p)) {
    console.error(`missing ${p} — run \`forge build\` first`);
    process.exit(1);
  }
  out[key] = JSON.parse(readFileSync(p, "utf8")).abi;
}
const text = JSON.stringify(out, null, 1) + "\n";
const target = join(ROOT, "shared", "abis.json");
if (process.argv.includes("--check")) {
  const cur = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (cur !== text) {
    console.error("shared/abis.json is stale — run `node shared/gen-abis.mjs`");
    process.exit(1);
  }
  console.log("shared/abis.json is up to date");
} else {
  writeFileSync(target, text);
  console.log(`wrote shared/abis.json (${Object.keys(out).length} contracts)`);
}
