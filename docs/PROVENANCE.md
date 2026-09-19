# Provenance of Multipli code and parameters

## Vendored sources (`src/multipli/`)

Fetched on 2026-09-19 from Blockscout's verified-source API for the Ethereum mainnet addresses listed
on Multipli's [contract addresses page](https://docs.multipli.fi/technical-architecture/rwausd-contract-addresses.md).
The files are **byte-identical** to the verified sources. Anyone can re-check them with:

```bash
node script/vendor/verify-multipli-sources.mjs
```

| Contract | Mainnet address | Local file | SHA-256 |
|---|---|---|---|
| Vat | `0xbC22e8C15bC476EF4FD0124c5A03b23607e30D2C` | `vat.sol` | `b8207df3560d9c4bf0fd7bada6d0bcad2577fe0e368e7ff906f88e19c785930b` |
| Spotter | `0xf3aee748355bb07CBe702B4ff8dBE6118b34e2A2` | `spot.sol` | `ad02b8e2d1699e33b57abe9b848697f07d5d2633ead1158934e78fc23567ba3f` |
| OSM | `0x89fbAe0302b8790D55fa36E6Ab09ac93F865993a` | `osm.sol` | `bc6ec6ecd789daa60372729cbc22ea44dc16497d941dc5866506b027ece40a5c` |
| ↳ ds-value | (OSM source bundle) | `lib/ds-value/value.sol` | `65a053d1396488ae64fc1ea0c63f2fe836ddd95b5f8ca5f7158501f11cef0740` |
| ↳ ds-thing | (OSM source bundle) | `lib/ds-thing/thing.sol` | `1b76590d427c64989d33d520f098a0bf5c1b216de539af4ee7b6bfe216c73928` |
| ↳ ds-auth | (OSM source bundle) | `lib/ds-auth/auth.sol` | `94b7deac8b65876badd5507f90bad3c464b54bd5e3727131776641fd691422c1` |
| ↳ ds-note | (OSM source bundle) | `lib/ds-note/note.sol` | `3097878768a300a87dcd199ec28262beacd6e0ea807493081459b83c664e98c7` |
| ↳ ds-math | (OSM source bundle) | `lib/ds-math/math.sol` | `48b94bb12a7d8c84d660a6ab585f60a247c7eb7ffb56d563ed0e9d6b52c84c53` |
| PriceFeedAdapter (PAXG) | `0x82F5790Bd1c96790E4c3a3ebC8142bD4D6F8b1CD` | `adapter.sol` | `99abd07607f28572a5ba3a16787ac7c391804687eadc87e4803fadad3e753e42` |
| GemJoin5 (PAXG) | `0x3c9567C3b9c20E72858cD5714209EA7D7a8011fD` | `join.sol` | `117b2b7819b06a51648d1a735dd197f4bddb5d89173f2b22f34e4771b755d411` |

**Compiler settings.** All five contracts are verified with solc `0.6.12+commit.27d51765`, the optimizer
on at 8000 runs, and EVM `istanbul`. `foundry.toml` pins `src/multipli/**` to exactly these settings
(`compilation_restrictions`). Blockscout's metadata snapshot is in `src/multipli/blockscout-meta.json`.

**Deployment in tests and the demo.** These contracts are deployed from their compiled artifacts with
`vm.deployCode`. They are not reimplemented or edited.

## Live configuration read from mainnet

Read with `cast call` against `https://ethereum-rpc.publicnode.com` at block **26,009,365**
(2026-09-19):

| Value | Result |
|---|---|
| PAXG ilk name (`GemJoin5.ilk()`) | `"paxg"` |
| `Spotter.ilks("paxg")` | pip = OSM `0x89fb…993a`, `mat` = 1.4e27 (140%) |
| `Spotter.par()` | 1e27 |
| `Vat.ilks("paxg")` | `Art` ≈ 42,650 wad, `rate` ≈ 1.00888 ray (≈ 43.0k rwaUSD debt), `line` = 1e51 rad (1,000,000 rwaUSD), `dust` = 2e47 rad (100 rwaUSD) |
| `OSM.hop()` / `OSM.src()` | 3600 / the PriceFeedAdapter |
| `PriceFeedAdapter.maxDelay()` | 86,400 (24h) |
| `PriceFeedAdapter.owner()` | `0x194Ebc1B9B382ef0E6998cAAcE59aF843cf53b99` (listed in Multipli's docs as the "RWAUSD Operator wallet") |

The demo mirrors `mat`, `hop`, `line`, `dust` and `maxDelay`. The demo PAXG price ($2,500) and every
ASO/Sentinel parameter are prototype choices.

## Multipli documentation we align with (design, not deployed code)

Multipli's [Collateral and Oracle Profile](https://docs.multipli.fi/technical-architecture/collateral-and-oracle-profile.md)
page describes:
- a read interface `getPrice(profileId) -> (price, status)`;
- EIP-712 attestations with the fields `profileId, price, validAfter, validUntil, nonce, sourceId`;
- N-of-M signers per profile;
- the statuses `OK`, `STALE` (issuance disabled, repayments allowed), `DISPUTED` and `HALTED`.

The page describes a design and makes no deployment claim. `ASOVerifier` follows it:
- It exposes `getPrice(profileId) -> (price, status)`.
- It uses those attestation fields, except that the signer `address` stands in for `sourceId`.
- It has the same four statuses plus `NO_DATA`.

We found no deployed contract that implements this in Multipli's address list.
