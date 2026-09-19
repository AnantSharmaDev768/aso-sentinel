# AI continuation context

Read `docs/PROJECT_HANDOFF.md` first. Facts an assistant needs before changing anything:

- **Toolchain:** Foundry v1.8.3 (`~/.foundry/bin`, may not be on PATH); `dynamic_test_linking = false` in `foundry.toml` is
  required. Node ≥ 20. `.gitattributes` forces LF.
- **Do not modify** `src/ASOVerifier.sol`, `src/ASOSentinel.sol` or `src/multipli/**` — they must stay byte-identical to the
  Sepolia deployment / Multipli mainnet source.
- **Do not change `src/risk/CostModel.sol` math**: `cost = capital × d × lossShare` is the tested implementation.
- **Single source of truth for scenarios:** `shared/origin-core.mjs` (engine), `shared/validation.mjs` (cases + evaluation),
  `shared/historical.mjs`, `shared/analysis.mjs`. The CLI demos, validation runner and dashboard all import these.
- **ABIs:** after any contract change run `node shared/gen-abis.mjs` (CI checks `--check`).
- **Validation results are generated**, never hand-edited: `cd demo && npm run validate` writes `validation/final/*.json`
  and `docs/VALIDATION.md`. `validation/baseline/` is the preserved original and must not be overwritten except by
  `--rules=baseline`. `--check` compares outcomes with the committed files.
- **Relayer duty:** after each accepted round call `riskEngine.sync()` (and `recordSources` for per-source data).
- **Local only:** the dashboard and demos use anvil public keys and refuse any chain but 31337. Never add real keys.
- **Honesty rules:** no fabricated metrics, hashes or addresses; label local / Sepolia / modelled evidence; no claims of
  audit, production readiness, Multipli integration or guaranteed safety.
- **Status (2026-09-19):** release committed on `feat/ui-redesign`. Known limitations are listed in the handoff and in
  README §14 / §23.
