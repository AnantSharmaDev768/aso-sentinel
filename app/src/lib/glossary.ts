// One- or two-sentence definitions shown in tooltips. Each describes THIS system, not the general concept.
export const GLOSSARY = {
  TWAP: 'Time-weighted average price of accepted oracle rounds over the last 6 h. A price far from its TWAP suggests a sudden move or manipulation.',
  'EIP-712': 'A standard for signing structured data. Each price source signs (price, round, validity window) bound to this chain and verifier contract, so signatures cannot be replayed elsewhere.',
  Quorum: 'The minimum number of distinct authorised sources that must sign a round: 3 of 5 here, a strict majority.',
  Attestation: 'A signed price statement from one source. A round bundles at least a quorum of attestations; the verifier accepts it only if they agree within 1%.',
  'Debt ceiling': 'The Vat’s `line`: the maximum total debt for this collateral. The Sentinel only ever changes this value; new borrowing reverts once debt would exceed it.',
  Headroom: 'Ceiling minus current debt: how much new debt can still be created right now.',
  OSM: 'Multipli’s Oracle Security Module: delays prices by 1 h. It keeps its cached price with `has = true` even when the feed goes stale.',
  Vat: 'Multipli’s core accounting contract (MakerDAO-derived). It tracks collateral and debt and enforces the debt ceiling.',
  Spotter: 'Multipli contract that reads the OSM price and writes the collateral’s borrowing price (`spot`) into the Vat.',
  'Effective price': 'The more conservative of the attested price and the TWAP: min(attested, TWAP). Risk checks use it.',
  Freshness: 'Time since the latest accepted round was observed. Past the maximum age (1 h) the data counts as STALE.',
  Disputed: 'A round whose signed prices spread by more than 1%. It is recorded, never used as a price, and it blocks new borrowing.',
  'Recovery delay': 'Time the Sentinel must spend in RECOVERING (1 h) — together with a newer accepted round — before borrowing can reopen.',
  'Cost / extractable': 'Estimated cost of pushing the price up enough to profit, divided by the debt that could be extracted. Below 1× manipulation looks profitable (HIGH); below 3× it is ELEVATED.',
  'Market depth': 'A governance ASSUMPTION of how many dollars move the price by 1%. It is not measured liquidity; a missing or stale value raises INSUFFICIENT DATA.',
  Poke: 'A permissionless call anyone can make. It re-reads every signal and applies the resulting state and debt ceiling.',
  Epoch: 'A 1-day window. Total debt may grow by at most the epoch cap (100,000 rwaUSD) per epoch, even when FRESH.',
} as const

export type Term = keyof typeof GLOSSARY
