# Sepolia Testnet Deployment Guide — ASO Sentinel

> [!IMPORTANT]
> **Scope & Nature of Deployment:**
> This is a **hackathon prototype deployed to Ethereum Sepolia testnet** (Chain ID `11155111`) for live verification and demonstration.
> - **Mocks:** Uses `MockRWA` (test collateral token), `MockAggregator` (test price feed), and 5 team-controlled source keys for signing EIP-712 price attestations.
> - **Timing:** Calibrated for ~12-second Sepolia blocks (`osmHop = 60s`, `maxAge = 300s`, `maxValidity = 600s`).
> - **Not Multipli:** This is an independent research prototype, **not** an official Multipli production deployment. Multipli's verified core contracts (`Vat`, `Spotter`, `OSM`, `GemJoin5`, `PriceFeedAdapter`) are compiled from verified mainnet sources (solc 0.6.12, 8000 runs, istanbul) and run as an isolated testnet showcase.
> - **Adapter `maxDelay = 24h`:** Multipli's adapter stale delay remains at its original 24h. The 25-hour frozen-feed staleness scenario (S6b) remains local Anvil-only.

---

## 1. 12 Deployed Contracts & Live Verification Status

All 12 contracts are deployed on Ethereum Sepolia and source-verified on **Sourcify** (exact match; checked 2026-09-19). Address links open **Blockscout**, which reads Sourcify and shows "Contract source code verified (exact match)". **Sepolia Etherscan does not show these contracts as verified**, because we verified through Sourcify only (no Etherscan API key was used); Etherscan still shows the transactions. Source verification proves the deployed bytecode matches this repository's source; it is **not** a security audit.

| Contract | Symbol / Role | Sepolia Contract Address (Blockscout) | Sourcify Verification | Solc Version |
|----------|---------------|--------------------------|-----------------------|--------------|
| **`MockRWA`** | `gem` (mPAXG) | [`0xb9c3458426070220dFADA63E41cD6D291c6C1eAe`](https://eth-sepolia.blockscout.com/address/0xb9c3458426070220dFADA63E41cD6D291c6C1eAe?tab=contract) | `exact_match` ✅ | 0.8.37 |
| **`MockAggregator`** | `feed` ($2,500) | [`0x2648A9D44C33992D814DA80468653111fD3901D4`](https://eth-sepolia.blockscout.com/address/0x2648A9D44C33992D814DA80468653111fD3901D4?tab=contract) | `exact_match` ✅ | 0.8.37 |
| **`PriceFeedAdapter`** | Multipli Adapter | [`0x747912D7bD3942b6067d16eC61C69a8bBcEB3851`](https://eth-sepolia.blockscout.com/address/0x747912D7bD3942b6067d16eC61C69a8bBcEB3851?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`OSM`** | Oracle Security Module | [`0xE515DE7b94b63A3f7b3245661B752cbbfde19Ed6`](https://eth-sepolia.blockscout.com/address/0xE515DE7b94b63A3f7b3245661B752cbbfde19Ed6?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`Vat` (Baseline)** | Multipli Core Accounting | [`0x6762Afe88F4761109141A8E2d296EA038b178483`](https://eth-sepolia.blockscout.com/address/0x6762Afe88F4761109141A8E2d296EA038b178483?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`Spotter` (Baseline)** | Collateral Pricing | [`0xbdBde656820e6FF8fc0D5538bbcE4daF942Fc322`](https://eth-sepolia.blockscout.com/address/0xbdBde656820e6FF8fc0D5538bbcE4daF942Fc322?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`GemJoin5` (Baseline)** | Collateral Join Adapter | [`0x613efe6a5F6Eec7457A10Bf2E04d016628F90f79`](https://eth-sepolia.blockscout.com/address/0x613efe6a5F6Eec7457A10Bf2E04d016628F90f79?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`Vat` (Protected)** | Guarded Accounting Vault | [`0x79150869244eDcde87e709F14577a08C90c994bB`](https://eth-sepolia.blockscout.com/address/0x79150869244eDcde87e709F14577a08C90c994bB?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`Spotter` (Protected)** | Guarded Collateral Pricing | [`0x5AEc269BbE8Cb7c3D81097040284F888F6f25FCA`](https://eth-sepolia.blockscout.com/address/0x5AEc269BbE8Cb7c3D81097040284F888F6f25FCA?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`GemJoin5` (Protected)**| Guarded Join Adapter | [`0xDEA615cdeC0CeD2B15093A71124d659A98ABBD11`](https://eth-sepolia.blockscout.com/address/0xDEA615cdeC0CeD2B15093A71124d659A98ABBD11?tab=contract) | `exact_match` ✅ | 0.6.12 |
| **`ASOVerifier`** | 3-of-5 Quorum Verifier | [`0x7a46253E1722b52387a0bac610a2CFD18458530B`](https://eth-sepolia.blockscout.com/address/0x7a46253E1722b52387a0bac610a2CFD18458530B?tab=contract) | `exact_match` ✅ | 0.8.37 |
| **`ASOSentinel`** | Active Ceiling Guard | [`0xbd83Ce0AAf941D87Af2fB50C0B4fF04Dd20FB0b2`](https://eth-sepolia.blockscout.com/address/0xbd83Ce0AAf941D87Af2fB50C0B4fF04Dd20FB0b2?tab=contract) | `exact_match` ✅ | 0.8.37 |

The full address configuration is recorded in [`deployments/11155111.json`](../deployments/11155111.json).

---

## 2. Wallet & Credential Separation Architecture

1. **Deployer (`0x8EF0d99596A608398588912124D89971d92900B3`):**
   - Admin & Guardian for `ASOVerifier` and `ASOSentinel`.
   - Single-use burner wallet generated with `cast wallet new`.
   - Private key stored strictly in `.env.sepolia` (gitignored).
2. **Relayer / Keeper (`0x172b89f91169f589F36Ec77eb283be64339adA69`):**
   - Configured as `feeder` on `MockAggregator`.
   - Holds 1,000 mPAXG collateral mint from deployment.
   - Executes permissionless keeper calls (`poke()`), submits rounds, and executes borrows.
3. **5 ASO Oracle Sources (`SOURCE_KEY_1..5` / `ASO_SIGNERS`):**
   - Pre-generated, dedicated EIP-712 signing keys stored in `.env.sepolia`.
   - Strictly off-chain signing keys: require **zero ETH**.
   - Ascending address set configured into `ASOVerifier` at deployment.
4. **Anvil Public Default Denylist:**
   - `DeploySepolia.s.sol` enforces that neither deployer, relayer, nor any of the 5 signers may match Anvil default accounts `#0` through `#9`.

---

## 3. Deployment & Execution Workflow

### 1. Dry Run (Zero Cost)
```bash
forge script script/DeploySepolia.s.sol --rpc-url "$SEPOLIA_RPC_URL" --private-key "$SEPOLIA_DEPLOYER_KEY"
```
Simulates the deployment and confirms the deployer address.

### 2. Broadcast Deployment & Automated Sourcify Verification
```bash
forge script script/DeploySepolia.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$SEPOLIA_DEPLOYER_KEY" \
  --broadcast \
  --verify \
  --verifier sourcify
```

### 3. Funding Relayer & Executing Testnet Scenarios
Transfer testnet ETH to relayer:
```bash
cast send 0x172b89f91169f589F36Ec77eb283be64339adA69 --value 0.01ether --private-key "$SEPOLIA_DEPLOYER_KEY" --rpc-url "$SEPOLIA_RPC_URL"
```

Run scenarios against Sepolia:
```bash
cd demo && npm run demo:sepolia
```

---

## 4. Measured Gas and Costs on Sepolia

- **Deployer Initial Funding:** `0.05000 ETH` (faucet tx `0x067db3daf8ff3f8a939cf601248764bb65fea35fa426f1d6b9e9eae4157b10b0`)
- **12-Contract Broadcast Deployment:** `19,051,595` gas (~`0.01621 ETH` at ~1.03–2.06 gwei)
- **Relayer Funding Transferred:** `0.01500 ETH` (initial 0.010 ETH + 0.005 ETH top-up)
- **Run 1 Cost (27 steps):** `~0.00195 ETH`
- **Run 2 Cost (27 steps):** `~0.00184 ETH`
- **Final Deployer Balance:** `0.01876 ETH`
- **Final Relayer Balance:** `0.01014 ETH`

---

## 5. Evidence and its limits

| Evidence | What it shows | What it does **not** show |
|---|---|---|
| Local anvil demo (`npm run demo`, 22 checks) | All 8 scenarios incl. the 25 h stale-feed case, using time travel on a private local chain | Anything on a public network |
| Sepolia runs below (27 checks per run, two runs) | Real public transactions: accepted/rejected attestations, restriction, repay-while-restricted, recovery, baseline over-borrowing | The 25 h stale-feed case (Multipli's adapter keeps its 24 h `maxDelay`; time cannot be warped on Sepolia) |
| Sourcify exact match (12/12) | Deployed bytecode = this repo's source | That the code is secure: **no external audit** has been done |
| Price sources | 5 keys generated and **controlled by the team**, signing prices the runner chooses | Independent production data providers |
| Multipli contracts | Copies of Multipli's verified mainnet source deployed **by us** on a testnet | Any integration with, deployment by, or endorsement from Multipli |

**Verification of the tables below (2026-09-19):** every one of the 34 linked transactions was checked against Sepolia: it exists, was sent by the relayer, and its receipt status matches the expected outcome (success or revert).
Run 2's raw JSON output is committed as [`deployments/11155111-scenarios-run2.json`](../deployments/11155111-scenarios-run2.json). Run 1's raw JSON file was overwritten during the session, so Run 1 is evidenced by the on-chain transactions linked below. The runner writes `deployments/11155111-scenarios.json` (gitignored); copy it to a new `-runN.json` file to commit future runs.
Earlier drafts of this page linked three Run 1 transactions that do not exist; they were replaced with the real transactions (relayer nonces 25, 26 and 29).
The relayer's history also contains one failed transaction at nonce 13 from a first attempt, before the runner read `maxValidity` from the deployment (it signed 1-hour windows; the testnet profile allows 600 s, so the verifier correctly reverted with `InvalidValidityWindow`).

## 6. Live Scenario Execution Results

Both runs completed with **`ALL SCENARIOS BEHAVED AS EXPECTED`** (27 / 27 checks passed in each run).

### Run 1: Initial Deployment & Verification

| # | Scenario | Check Description | Expected | Actual | Result | Etherscan Transaction |
|---|----------|-------------------|----------|--------|--------|-----------------------|
| 1 | `S1` | ASOVerifier.submitRound (3-of-5 quorum, $2,500) | `success` | `success` | ✅ PASS | [`0x6c4cedbb...`](https://sepolia.etherscan.io/tx/0x6c4cedbbfeaab856d271fc82bc65ae1adef94a6bbd513462e4ee976b234843b4) |
| 2 | `S1` | ASOSentinel.poke() (opens bounded headroom) | `success` | `success` | ✅ PASS | [`0x91259a79...`](https://sepolia.etherscan.io/tx/0x91259a79a818624e923df0e7d6e9c2a3e2591b04060a135456a1955a89f8e6ce) |
| 3 | `S1` | Protected line > 0 after S1 poke | `line > 0` | `line=200000000000000000000000000` | ✅ PASS | *(State assertion)* |
| 4 | `S1` | Sentinel not restricted after S1 poke | `restricted=false` | `restricted=false` | ✅ PASS | *(State assertion)* |
| 5 | `S1` | Borrow 5,000 rwaUSD on BASELINE Vat | `success` | `success` | ✅ PASS | [`0x4ade9b99...`](https://sepolia.etherscan.io/tx/0x4ade9b99cb56a430e3f3f01f1ac5e00d0f34eb4a105e0ab373eb97c4350733e0) |
| 6 | `S1` | Borrow 5,000 rwaUSD on PROTECTED Vat | `success` | `success` | ✅ PASS | [`0xea8e5315...`](https://sepolia.etherscan.io/tx/0xea8e5315d8e5d16e73ea19467f6e81f8bbf912e9ca960b3fe7e87dc3a23b9be5) |
| 7 | `S4` | Submit tampered signature -> must revert InvalidSignature | `revert contains 'InvalidSignature'` | `reverted: InvalidSignature(0)` | ✅ PASS | [`0x5e905e44...`](https://sepolia.etherscan.io/tx/0x5e905e442d7a430de82f3a61a5f55780e4a453026e6e525c757afd6fa68f0620) |
| 8 | `S5` | Submit replayed nonce round -> must revert NonceNotIncreasing | `revert contains 'NonceNotIncreasing'` | `reverted: NonceNotIncreasing(1, ` | ✅ PASS | [`0xe7cdcda4...`](https://sepolia.etherscan.io/tx/0xe7cdcda48f6fd3631271c3f338e2fadd5609c5d3dab48096b34e00b5fc8d73d0) |
| 9 | `S3` | ASOVerifier.submitRound (>1% spread -> DISPUTED) | `success` | `success` | ✅ PASS | [`0x31654790...`](https://sepolia.etherscan.io/tx/0x3165479014ce71d288c12e089ca0d0a769d136f4aa5d0d57e85e32e5003f1eef) |
| 10 | `S3` | Verifier status is DISPUTED (3) | `status=3` | `status=3` | ✅ PASS | *(State assertion)* |
| 11 | `S3` | ASOSentinel.poke() (throttles line to 0) | `success` | `success` | ✅ PASS | [`0xe40ef733...`](https://sepolia.etherscan.io/tx/0xe40ef733bd39e338f9b04f37eff01c068f6f59a6e19858b6de42e4ead7251632) |
| 12 | `S3` | Protected line == 0 after dispute poke | `line=0` | `line=0` | ✅ PASS | *(State assertion)* |
| 13 | `S3` | Sentinel restricted == true after dispute poke | `restricted=true` | `restricted=true` | ✅ PASS | *(State assertion)* |
| 14 | `S3` | Borrow while restricted -> must revert Vat/ceiling-exceeded | `revert contains 'Vat/ceiling-exceeded'` | `reverted: Error(Vat/ceiling-exce` | ✅ PASS | [`0x48833e65...`](https://sepolia.etherscan.io/tx/0x48833e6539c68acd3f699c5bdb5085f7ec4bd9ac720b99c656a378184735c796) |
| 15 | `S8` | Repay 2,000 rwaUSD while restricted (S8) | `success` | `success` | ✅ PASS | [`0xdd34ef69...`](https://sepolia.etherscan.io/tx/0xdd34ef699090f99c7491ddecc67bf149b6909b3391e40ee6037f2f6fe49ceca8) |
| 16 | `S7` | ASOVerifier.submitRound (agreeing data restores OK) | `success` | `success` | ✅ PASS | [`0x227a2396...`](https://sepolia.etherscan.io/tx/0x227a239685bbfd801f9fd45e30194cc8157e71cfb0e97ceff6c119e7a745745d) |
| 17 | `S7` | ASOSentinel.poke() (restores headroom) | `success` | `success` | ✅ PASS | [`0x22b5d4db...`](https://sepolia.etherscan.io/tx/0x22b5d4db973c4e5f2de279cf3a6724a27bab7d3ab97aebd7d41c72094d4209a6) |
| 18 | `S7` | Protected line > 0 after recovery poke | `line > 0` | `line=203000000000000000000000000` | ✅ PASS | *(State assertion)* |
| 19 | `S7` | Sentinel restricted == false after recovery poke | `restricted=false` | `restricted=false` | ✅ PASS | *(State assertion)* |
| 20 | `S7` | Borrow on PROTECTED Vat after recovery -> succeeds | `success` | `success` | ✅ PASS | [`0x62e2dc67...`](https://sepolia.etherscan.io/tx/0x62e2dc67d5cdc133d5edc12e195ef05999ca7b61cfdadd7df070aad019d68eb1) |
| 21 | `S6` | ASOVerifier.submitRound (attests real price dropped to $1,500) | `success` | `success` | ✅ PASS | [`0x7fdcee49...`](https://sepolia.etherscan.io/tx/0x7fdcee49ca2078f0a8748904b232708e2bac19e7fdde2f7bd836371d2df2dfc6) |
| 22 | `S6` | ASOSentinel.poke() (detects Vat price above attested -> RESTRICTS) | `success` | `success` | ✅ PASS | [`0x02a5dc72...`](https://sepolia.etherscan.io/tx/0x02a5dc720195521ae07e840439ad7f39183fcae14ff48c6291752a18d1b20f49) |
| 23 | `S6` | Sentinel lastReason is VAT_PRICE_ABOVE_ATTESTED (6) | `reason=6` | `reason=6` | ✅ PASS | *(State assertion)* |
| 24 | `S6` | Protected line == 0 after S6 poke | `line=0` | `line=0` | ✅ PASS | *(State assertion)* |
| 25 | `S6` | Sentinel restricted == true after S6 poke | `restricted=true` | `restricted=true` | ✅ PASS | *(State assertion)* |
| 26 | `S6` | Baseline Vat still allows borrow at stale price (Bad Debt) | `success` | `success` | ✅ PASS | [`0xdd5f1c64...`](https://sepolia.etherscan.io/tx/0xdd5f1c645ef87248d8ee470627a016f2b50ae2017b1dd19dc55a70723394a292) |
| 27 | `S6` | Protected Vat frob -> reverts with Vat/ceiling-exceeded | `revert contains 'Vat/ceiling-exceeded'` | `reverted: Error(Vat/ceiling-exce` | ✅ PASS | [`0xc46fb229...`](https://sepolia.etherscan.io/tx/0xc46fb229b52f1d62a33d1f514b8a6841f5d50ab6d7984ba629723f89d8f2557b) |

### Run 2: Re-Run Proving Dynamic Nonce Continuation & Re-entry

| # | Scenario | Check Description | Expected | Actual | Result | Etherscan Transaction |
|---|----------|-------------------|----------|--------|--------|-----------------------|
| 1 | `S1` | ASOVerifier.submitRound (3-of-5 quorum, $2,500) | `success` | `success` | ✅ PASS | [`0x0712d971...`](https://sepolia.etherscan.io/tx/0x0712d971de377246327fbaed73c8361bd74561b7aea8265152734474f7ef979f) |
| 2 | `S1` | ASOSentinel.poke() (opens bounded headroom) | `success` | `success` | ✅ PASS | [`0x19ec530e...`](https://sepolia.etherscan.io/tx/0x19ec530ee012407b14d448c1b20b85d607a84e047b7c274cd16d33ec09ca84c3) |
| 3 | `S1` | Protected line > 0 after S1 poke | `line > 0` | `line=204000000000000000000000000` | ✅ PASS | *(State assertion)* |
| 4 | `S1` | Sentinel not restricted after S1 poke | `restricted=false` | `restricted=false` | ✅ PASS | *(State assertion)* |
| 5 | `S1` | Borrow 5,000 rwaUSD on BASELINE Vat | `success` | `success` | ✅ PASS | [`0x7b814ceb...`](https://sepolia.etherscan.io/tx/0x7b814ceb3494f2f442ea0bb27e7619809722e52b5c438088ec4327b8561c569e) |
| 6 | `S1` | Borrow 5,000 rwaUSD on PROTECTED Vat | `success` | `success` | ✅ PASS | [`0x1090358b...`](https://sepolia.etherscan.io/tx/0x1090358b3c335b8f6fdbf8e724545873441e77a7e5636225118c131af3c191e6) |
| 7 | `S4` | Submit tampered signature -> must revert InvalidSignature | `revert contains 'InvalidSignature'` | `reverted: InvalidSignature(0)` | ✅ PASS | [`0x9d0fe6d1...`](https://sepolia.etherscan.io/tx/0x9d0fe6d1cb4238a303e3d341ebf870ab39879e5ebcc5d4f335d2af38e113c4af) |
| 8 | `S5` | Submit replayed nonce round -> must revert NonceNotIncreasing | `revert contains 'NonceNotIncreasing'` | `reverted: NonceNotIncreasing(6, ` | ✅ PASS | [`0x570b859a...`](https://sepolia.etherscan.io/tx/0x570b859a0a6b5ac4c9f9a18a670638553b1c301534ae1d8b92f2a530b0233533) |
| 9 | `S3` | ASOVerifier.submitRound (>1% spread -> DISPUTED) | `success` | `success` | ✅ PASS | [`0xfe8978d9...`](https://sepolia.etherscan.io/tx/0xfe8978d940a335e5250b6d3d9f669e89cba3f0865b8eb17feb390b250b27b8d9) |
| 10 | `S3` | Verifier status is DISPUTED (3) | `status=3` | `status=3` | ✅ PASS | *(State assertion)* |
| 11 | `S3` | ASOSentinel.poke() (throttles line to 0) | `success` | `success` | ✅ PASS | [`0x6b3f05f0...`](https://sepolia.etherscan.io/tx/0x6b3f05f08eaab20ea7c62fd0827c4f320c11cdc3050440758c3caff6bbca69b1) |
| 12 | `S3` | Protected line == 0 after dispute poke | `line=0` | `line=0` | ✅ PASS | *(State assertion)* |
| 13 | `S3` | Sentinel restricted == true after dispute poke | `restricted=true` | `restricted=true` | ✅ PASS | *(State assertion)* |
| 14 | `S3` | Borrow while restricted -> must revert Vat/ceiling-exceeded | `revert contains 'Vat/ceiling-exceeded'` | `reverted: Error(Vat/ceiling-exce` | ✅ PASS | [`0xeb65cffb...`](https://sepolia.etherscan.io/tx/0xeb65cffb99b84df853dadbc71d273a840b3c4b434a67de6e43d56f7d1862aa24) |
| 15 | `S8` | Repay 2,000 rwaUSD while restricted (S8) | `success` | `success` | ✅ PASS | [`0xc002fdee...`](https://sepolia.etherscan.io/tx/0xc002fdee5997dc2b3be49fce967c68cff855f0c644be719e81180db70d60fe0c) |
| 16 | `S7` | ASOVerifier.submitRound (agreeing data restores OK) | `success` | `success` | ✅ PASS | [`0xd4b638d6...`](https://sepolia.etherscan.io/tx/0xd4b638d667922916d3b569e927f99bc74fd3f0084929f495f32e4371ea810155) |
| 17 | `S7` | ASOSentinel.poke() (restores headroom) | `success` | `success` | ✅ PASS | [`0x54a550e5...`](https://sepolia.etherscan.io/tx/0x54a550e5af9437bd7b5f211f72fa4176b3e566935b053d462548a8ea49815468) |
| 18 | `S7` | Protected line > 0 after recovery poke | `line > 0` | `line=207000000000000000000000000` | ✅ PASS | *(State assertion)* |
| 19 | `S7` | Sentinel restricted == false after recovery poke | `restricted=false` | `restricted=false` | ✅ PASS | *(State assertion)* |
| 20 | `S7` | Borrow on PROTECTED Vat after recovery -> succeeds | `success` | `success` | ✅ PASS | [`0xc2d99ae7...`](https://sepolia.etherscan.io/tx/0xc2d99ae72ca6ae0abff35982ee50194a868dc54b60ce4ae1631c3e7c24941b7c) |
| 21 | `S6` | ASOVerifier.submitRound (attests real price dropped to $1,500) | `success` | `success` | ✅ PASS | [`0xfdddafb4...`](https://sepolia.etherscan.io/tx/0xfdddafb4051ab2197e1405b1cc245d8388befe45c0ed3ab79ed0ebb5f35e601b) |
| 22 | `S6` | ASOSentinel.poke() (detects Vat price above attested -> RESTRICTS) | `success` | `success` | ✅ PASS | [`0xb143acef...`](https://sepolia.etherscan.io/tx/0xb143acefe678ec61518108454cff8c3bcfadc4e3369bcb7c3e153eb700b59eaa) |
| 23 | `S6` | Sentinel lastReason is VAT_PRICE_ABOVE_ATTESTED (6) | `reason=6` | `reason=6` | ✅ PASS | *(State assertion)* |
| 24 | `S6` | Protected line == 0 after S6 poke | `line=0` | `line=0` | ✅ PASS | *(State assertion)* |
| 25 | `S6` | Sentinel restricted == true after S6 poke | `restricted=true` | `restricted=true` | ✅ PASS | *(State assertion)* |
| 26 | `S6` | Baseline Vat still allows borrow at stale price (Bad Debt) | `success` | `success` | ✅ PASS | [`0x01c12647...`](https://sepolia.etherscan.io/tx/0x01c12647638d44ea3e4615f5bf71d2b2ca81bd7751293b705a6c6bad352c5c6f) |
| 27 | `S6` | Protected Vat frob -> reverts with Vat/ceiling-exceeded | `revert contains 'Vat/ceiling-exceeded'` | `reverted: Error(Vat/ceiling-exce` | ✅ PASS | [`0xe31d6653...`](https://sepolia.etherscan.io/tx/0xe31d6653781e5e0c0d55effe7b1d36b975fd386e7aa8320f36cf3504b1ebc418) |

## Re-check (2026-09-19)

Read-only re-verification against a public Sepolia RPC: all 12 contract addresses in `deployments/11155111.json` have
deployed code (the 13th address, the relayer, is a wallet and correctly has none), and all 17 transaction hashes linked
from Run 2 return receipts. No redeployment was made. Two historical-source links (Medium post-mortems) return HTTP 403
to automated checks; they are secondary sources and were not re-verified automatically.
