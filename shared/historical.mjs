// Historical oracle / price-manipulation incidents used for RETROSPECTIVE validation.
//
// Three kinds of statement are kept strictly apart:
//   facts        DOCUMENTED HISTORICAL FACT — only what the cited sources state (checked 2026-09-19)
//   mapping      OUR RETROSPECTIVE SIGNAL MAPPING — our interpretation of which Origin signal corresponds
//   reproduced   REPRODUCED TEST — validation cases that recreate the PATTERN with synthetic prices on a local chain
//   notModeled   what the prototype does not reproduce
// No case replays historical market data. None of this claims Origin "would have prevented" an incident.

export const HISTORICAL = [
  {
    id: "synthetix-2019",
    name: "Synthetix sKRW oracle incident",
    protocol: "Synthetix",
    date: "2019-06-25",
    pattern: "Faulty source, too few sources",
    facts: [
      "One commercial price API intermittently reported the Korean won about 1000x too high.",
      "Because of an unrelated outage only two APIs were serving the KRW feed, and the oracle averaged the two remaining prices, propagating the error.",
      "Trading bots converted into sKRW during the mispricing window; the operator agreed to reverse the trades for a bug bounty. The oracle was halted and redundant feeds were added.",
    ],
    sources: [{ label: "Synthetix blog — Response to Oracle Incident", url: "https://blog.synthetix.io/response-to-oracle-incident/" }],
    mapping: "Two things Origin's verifier checks: with only 2 of 5 sources a round cannot reach the 3-of-5 quorum (no new price is accepted; the last one ages out → PROTECTIVE), and a 1000x outlier signed next to honest sources makes the spread exceed 1% → DISPUTED.",
    reproduced: ["S2", "M1", "F3"],
    notModeled: "Averaging logic of the historical oracle; FX-API data; the synthetic-asset exchange itself.",
  },
  {
    id: "bzx-2020",
    name: "bZx oracle manipulation (second attack)",
    protocol: "bZx / Fulcrum",
    date: "2020-02-18",
    pattern: "In-transaction DEX price manipulation",
    facts: [
      "Within a single transaction the attacker moved the sUSD/ETH price on Uniswap and a Kyber reserve, which bZx used together as its price oracle.",
      "Qin et al. report a profit of 2,381.41 ETH (about $634.9k) for this attack.",
    ],
    sources: [{ label: "Qin, Zhou, Livshits, Gervais — Attacking the DeFi Ecosystem with Flash Loans for Fun and Profit (FC 2021)", url: "https://arxiv.org/abs/2003.03810" }],
    mapping: "Origin does not read on-chain spot prices: it accepts off-chain signed rounds with freshness and a 1% agreement rule. If sources nevertheless reported a sudden manipulated jump, the velocity and TWAP-deviation signals are the relevant ones.",
    reproduced: ["A2"],
    notModeled: "Flash-loan atomicity and on-chain AMM spot oracles: the prototype has no DEX and sources sign off-chain.",
  },
  {
    id: "compound-2020",
    name: "Compound DAI liquidation event",
    protocol: "Compound",
    date: "2020-11-26",
    pattern: "Single-venue price spike",
    facts: [
      "The price feed was a Coinbase-reported price, anchored to within 20% of Uniswap's time-weighted average price.",
      "DAI traded at about $1.30 on Coinbase Pro; 124 addresses were liquidated and liquidators repaid a total of 85.2 million DAI.",
    ],
    sources: [{ label: "Compound Community Forum — DAI Liquidation Event", url: "https://www.comp.xyz/t/dai-liquidation-event/642" }],
    mapping: "A +30% move of the reported price corresponds to Origin's velocity (≥ 20%/h) and TWAP-deviation (≥ 15%) PROTECTIVE signals. Origin only gates NEW borrowing.",
    reproduced: ["A2"],
    notModeled: "Liquidations: Origin never changes the collateral price and no liquidation module is deployed, so the main harm in this incident (liquidations at a spiked price) is outside Origin's scope.",
  },
  {
    id: "inverse-2022",
    name: "Inverse Finance INV price manipulation",
    protocol: "Inverse Finance (Anchor)",
    date: "2022-04-02",
    pattern: "Thin-liquidity pool + TWAP oracle",
    facts: [
      "The INV price came from a Keep3rV2 TWAP oracle on a SushiSwap INV-ETH pair with small reserves (CertiK: 432 INV / 46 ETH before the swap); a timing check in the oracle update was bypassed, so the manipulated price was used.",
      "No flash loan was used: the attacker used their own capital.",
      "The attacker borrowed 1,588 ETH, 94 WBTC, about 4 million DOLA and 39 YFI; CertiK estimated the loss at about $14.5 million (Inverse Finance's own post-mortem reports its figures separately).",
    ],
    sources: [
      { label: "CertiK — Inverse Finance 02 April 2022", url: "https://www.certik.com/resources/blog/inverse-finance-02-april-2022" },
      { label: "Inverse Finance — INV Price Manipulation Incident (post-mortem)", url: "https://medium.com/inverse-finance/inv-price-manipulation-incident-55ea0433f4fc" },
    ],
    mapping: "Thin market → the cost gate (low depth assumption makes manipulation look cheap) plus TWAP/velocity. The incident is also a reminder of Origin's own limit: a TWAP can be manipulated or absorb a sustained move.",
    reproduced: ["A1", "A3", "A4"],
    notModeled: "The specific TWAP sampling bug and the AMM pool; Origin's TWAP is computed from signed rounds, not a DEX.",
  },
  {
    id: "venus-2022",
    name: "Venus Protocol LUNA price floor",
    protocol: "Venus Protocol",
    date: "2022-05-12",
    pattern: "Upstream feed stopped while the market fell",
    facts: [
      "Chainlink's LUNA/USD feed hit its price-floor threshold and stopped at $0.107 while LUNA traded around $0.01.",
      "Per Venus's statement, two accounts deposited about 230 million LUNA and borrowed about $13.5 million; the loss was about $11 million, covered from Venus's risk fund.",
    ],
    sources: [
      { label: "The Record (Recorded Future News) — Venus Protocol exploit, quoting Venus's statement", url: "https://therecord.media/collapse-of-luna-cryptocurrency-leads-to-11-million-exploit-on-venus-protocol" },
      { label: "Venus Protocol — LUNA Incident Update 2", url: "https://medium.com/venusprotocol/venus-protocol-luna-incident-update-2-c334475d9214" },
    ],
    mapping: "The lending market's price was far above the real market. If independent sources report the real price, Origin's Vat-above-effective-price check (> 2%) restricts borrowing; a frozen upstream feed is also caught by Multipli's adapter staleness (24 h).",
    reproduced: ["F1", "F2"],
    notModeled: "A feed that stays 'fresh' but floored: Origin relies on its own signed sources seeing the real price.",
  },
  {
    id: "mango-2022",
    name: "Mango Markets MNGO manipulation",
    protocol: "Mango Markets",
    date: "2022-10-11",
    pattern: "Thin-market pump reported honestly by the oracle",
    facts: [
      "According to the CFTC, MNGO was bought rapidly on three exchanges that were the inputs of Mango's oracle; the oracle price rose over 13-fold within 30 minutes.",
      "The inflated value was used to borrow and withdraw over $110 million (SEC: about $116 million). These are regulators' allegations; a federal judge later overturned the criminal convictions.",
    ],
    sources: [
      { label: "CFTC press release 8647-23", url: "https://www.cftc.gov/PressRoom/PressReleases/8647-23" },
      { label: "SEC press release 2023-13", url: "https://www.sec.gov/newsroom/press-releases/2023-13" },
      { label: "TRM Labs — convictions overturned", url: "https://www.trmlabs.com/resources/blog/breaking-federal-judge-overturns-all-criminal-convictions-in-mango-markets-case-against-avraham-eisenberg" },
    ],
    mapping: "Every oracle input reported the manipulated market: the exact case a source quorum cannot catch. Origin's velocity, TWAP-deviation and cost-gate signals are the relevant layer.",
    reproduced: ["A1", "V5"],
    notModeled: "Perpetual-swap mechanics and the real MNGO order books; our pump is +60% on synthetic prices, not 13x.",
  },
];
