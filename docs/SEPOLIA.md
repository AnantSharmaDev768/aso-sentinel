# Sepolia Testnet Deployment Guide — ASO Sentinel

> [!IMPORTANT]
> **Scope & Nature of Deployment:**
> This is a **hackathon prototype deployed to Ethereum Sepolia testnet** for live verification and demonstration.
> - **Mocks:** Uses `MockRWA` (test token), `MockAggregator` (test price feed), and 5 team-controlled source keys for signing EIP-712 price attestations.
> - **Timing:** Uses shortened timings (`osmHop = 60s`, `maxAge = 300s`, `maxValidity = 600s`) calibrated for ~12-second Sepolia blocks.
> - **Not Multipli:** This is an independent research prototype, **not** an official Multipli production deployment. Multipli's verified core contracts (`Vat`, `Spotter`, `OSM`, `GemJoin5`, `PriceFeedAdapter`) are compiled from verified mainnet sources (solc 0.6.12, 8000 runs, istanbul) and run as an isolated testnet showcase.

---

## 1. 12 Deployed Contracts Architecture

A complete deployment on Sepolia provisions **12 contracts** fed by the same price path:

1. **`MockRWA` (`gem`):** ERC-20 collateral token (mock PAXG), minted to the relayer for testing.
2. **`MockAggregator` (`feed`):** 8-decimal Chainlink-compatible oracle mock with `feeder = RELAYER`.
3. **`PriceFeedAdapter` (`adapter`):** Multipli's verified mainnet adapter (24h `maxDelay`).
4. **`OSM` (`osm`):** Multipli's verified mainnet Oracle Security Module (`osmHop = 60s`).
5. **Baseline Stack — `Vat` (`baselineVat`):** Multipli's core accounting vault without Sentinel protection.
6. **Baseline Stack — `Spotter` (`baselineSpotter`):** Multipli's collateral pricing module.
7. **Baseline Stack — `GemJoin5` (`baselineJoin`):** Multipli's collateral adapter.
8. **Protected Stack — `Vat` (`protectedVat`):** Multipli's core accounting vault guarded by ASOSentinel.
9. **Protected Stack — `Spotter` (`protectedSpotter`):** Collateral pricing module for protected stack.
10. **Protected Stack — `GemJoin5` (`protectedJoin`):** Collateral adapter for protected stack.
11. **`ASOVerifier` (`verifier`):** EIP-712 multi-source quorum verifier (3-of-5, median, spread <= 1%).
12. **`ASOSentinel` (`sentinel`):** Debt ceiling guard relying on `ASOVerifier` to throttle `protectedVat.line`.

---

## 2. Testnet Timing Calibration & Scope Constraints

On Sepolia testnet, EVM time cannot be warped (`vm.warp` is local only). To allow interactive evaluation without hours of waiting:
- **`osmHop = 60s`:** The OSM delay is shortened from Multipli's 3600s to 60s (~5 Sepolia blocks), enabling two-step OSM priming and price updates in ~1 minute.
- **`maxAge = 300s`:** ASO attestation freshness window is 5 minutes.
- **`maxValidity = 600s`:** Max attestation validity is 10 minutes.
- **Adapter `maxDelay = 24h`:** Multipli's PriceFeedAdapter stale delay remains at its original 24h. Consequently, the 25-hour frozen-feed staleness scenario (S6b) remains **local Anvil only** and is not executed on testnet.

---

## 3. Credential Model & Role Decoupling

1. **Deployer (`--account <keystore>` or `--private-key`):**
   - Admin and Guardian for `ASOVerifier` and `ASOSentinel`.
   - Requires ~0.05–0.1 Sepolia ETH for deploying the 12 contracts.
2. **Relayer / Keeper (`RELAYER` / `SEPOLIA_RELAYER_KEY`):**
   - Set as `feeder` on `MockAggregator`.
   - Receives initial 1,000 mPAXG collateral to deposit and borrow in scenarios.
   - Submits rounds and calls `poke()` on testnet.
3. **5 ASO Oracle Sources (`SOURCE_KEY_1..5` / `ASO_SIGNERS`):**
   - 5 dedicated keys generated via `cast wallet new` and stored in `.env.sepolia` (strictly gitignored).
   - Off-chain EIP-712 signers; require **zero ETH**.
   - Their addresses are sorted ascending and passed to `DeploySepolia.s.sol` via `ASO_SIGNERS`.

### Git Hygiene
- `.gitignore` ignores `/broadcast/` to keep git clean from verbose transaction logs and receipts. (Forge broadcast files hold no private keys; sensitive values go to `cache/` which is already ignored).
- `.env.sepolia` is strictly gitignored.
- `deployments/11155111.json` is tracked, containing public contract addresses.

---

## 4. Deployment Instructions

### Prerequisites
Populate `.env.sepolia` from `.env.sepolia.example`:
```bash
cp .env.sepolia.example .env.sepolia
# Fill in SEPOLIA_RPC_URL, RELAYER, SEPOLIA_RELAYER_KEY, SOURCE_KEY_1..5, ASO_SIGNERS
```

### Dry-Run Simulation (Zero Gas)
```bash
forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL
```
Verify gas estimate (~18.9M gas) and execution traces.

### Broadcast Deployment
Using Foundry keystore:
```bash
forge script script/DeploySepolia.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --account sepolia-deployer \
  --broadcast \
  --verify
```
Or using testnet deployer key:
```bash
forge script script/DeploySepolia.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $SEPOLIA_DEPLOYER_KEY \
  --broadcast \
  --verify
```

### Contract Verification (Solc 0.6.12 Fallback)
If verification of the 0.6.12 Multipli contracts fails during broadcast, verify individually:
```bash
forge verify-contract <VAT_ADDRESS> src/multipli/vat.sol:Vat \
  --compiler-version 0.6.12 \
  --optimizer-runs 8000 \
  --evm-version istanbul \
  --chain-id 11155111
```

---

## 5. Running On-Chain Scenarios on Sepolia

Run the deterministic testnet scenarios:
```bash
cd demo && npm run demo:sepolia
```
Optional: run with attestation expiry wait (waits 310s by block time):
```bash
cd demo && npm run demo:sepolia -- --with-waits
```
Results, mined transaction hashes, and Etherscan links are recorded in `deployments/11155111-scenarios.json`.
