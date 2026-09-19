// What Origin does NOT claim to protect against (shown on Evidence, Validation and in the report).
export const BOUNDARIES = [
  { t: 'Long-duration manipulation can enter the TWAP window', d: 'A price held longer than 6 h stops looking like a deviation. The epoch growth cap and WATCH headroom bound what can be borrowed; they do not detect it.' },
  { t: 'Small manipulation can stay below thresholds', d: 'Moves under 3% (and under 5%/h) are not flagged. At a 140% liquidation ratio such a move alone cannot create bad debt.' },
  { t: 'Manipulation-cost results depend on the depth assumption', d: 'Depth is a governance input, not measured liquidity. A wrong assumption moves the cost gate in the same direction.' },
  { t: 'A compromised source majority passes the verifier', d: 'If 3 or more sources collude, the round is cryptographically valid. Only the economic signals can object, and only for large or fast moves.' },
  { t: 'Demo sources are controlled test sources', d: 'The five sources are anvil / team keys, not independent data providers.' },
  { t: 'Prototype, not a production deployment', d: 'Not audited; not integrated with Multipli; liquidations and collateral withdrawal are outside its scope.' },
]
