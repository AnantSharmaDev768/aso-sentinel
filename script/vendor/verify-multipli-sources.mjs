// Re-downloads Multipli's verified contract sources from Blockscout (Ethereum mainnet) and checks that
// the files vendored in src/multipli/ are byte-identical. Run from the repo root:
//   node script/vendor/verify-multipli-sources.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Addresses from https://docs.multipli.fi/technical-architecture/rwausd-contract-addresses.md
const targets = {
  Vat: { addr: "0xbC22e8C15bC476EF4FD0124c5A03b23607e30D2C", files: { "src/vat.sol": "vat.sol" } },
  Spotter: { addr: "0xf3aee748355bb07CBe702B4ff8dBE6118b34e2A2", files: { "src/spot.sol": "spot.sol" } },
  PriceFeedAdapter: { addr: "0x82F5790Bd1c96790E4c3a3ebC8142bD4D6F8b1CD", files: { "src/adapter.sol": "adapter.sol" } },
  GemJoin5: { addr: "0x3c9567C3b9c20E72858cD5714209EA7D7a8011fD", files: { "src/join.sol": "join.sol" } },
  OSM: {
    addr: "0x89fbAe0302b8790D55fa36E6Ab09ac93F865993a",
    files: {
      "src/osm.sol": "osm.sol",
      "lib/ds-value/src/value.sol": "lib/ds-value/value.sol",
      "lib/ds-value/lib/ds-thing/src/thing.sol": "lib/ds-thing/thing.sol",
      "lib/ds-token/lib/ds-auth/src/auth.sol": "lib/ds-auth/auth.sol",
      "lib/ds-value/lib/ds-thing/lib/ds-note/src/note.sol": "lib/ds-note/note.sol",
      "lib/ds-token/lib/ds-math/src/math.sol": "lib/ds-math/math.sol",
    },
  },
};

let ok = true;
for (const [name, { addr, files }] of Object.entries(targets)) {
  const j = await (await fetch(`https://eth.blockscout.com/api/v2/smart-contracts/${addr}`)).json();
  const remote = new Map([[j.file_path, j.source_code], ...(j.additional_sources ?? []).map((f) => [f.file_path, f.source_code])]);
  for (const [remotePath, localPath] of Object.entries(files)) {
    const local = readFileSync(join("src", "multipli", localPath), "utf8");
    const same = remote.get(remotePath) === local;
    ok &&= same;
    console.log(`${same ? "MATCH   " : "MISMATCH"} ${name.padEnd(16)} ${addr}  ${remotePath} -> src/multipli/${localPath}`);
  }
  console.log(`         compiler ${j.compiler_version}, optimizer ${j.optimization_enabled} (${j.optimization_runs} runs), evm ${j.evm_version}, verified ${j.is_verified}`);
}
console.log(ok ? "\nAll vendored Multipli sources are byte-identical to the verified mainnet sources." : "\nMISMATCH FOUND");
process.exit(ok ? 0 : 1);
