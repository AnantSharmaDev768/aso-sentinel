# Manual mutation testing: each mutant weakens one security check; a KILLED mutant means at least
# one test failed. Run from the repo root:  python test/mutation/run_mutations.py
# Requires dynamic_test_linking = false in foundry.toml (otherwise tests can run on stale bytecode).
import subprocess, sys, shutil
muts = [
 ("src/ASOVerifier.sol","if (nonce <= lastNonce) revert NonceNotIncreasing(nonce, lastNonce);","","replay check removed"),
 ("src/ASOVerifier.sol","if (n < quorum) revert QuorumNotMet(n, quorum);","if (n == 0) revert QuorumNotMet(n, quorum);","quorum check weakened"),
 ("src/ASOVerifier.sol","if (signer <= prev) revert SignersNotStrictlyAscending(i);","","duplicate-source check removed"),
 ("src/ASOVerifier.sol","if (!isSigner[signer]) revert UnauthorizedSigner(signer);","","authorization check removed"),
 ("src/ASOVerifier.sol","|| signer != a.source) revert InvalidSignature(i);",") revert InvalidSignature(i);","signer==source check removed"),
 ("src/ASOVerifier.sol","if (block.timestamp > a.validUntil) revert Expired(i);","","expiry check removed"),
 ("src/ASOVerifier.sol","if (block.timestamp - a.validAfter > maxAge) revert StaleAttestation(i);","","freshness-at-submit removed"),
 ("src/ASOVerifier.sol","if (block.timestamp > expiresAt || block.timestamp - observedAt > maxAge) return Status.STALE;","","staleness-at-read removed"),
 ("src/ASOVerifier.sol","if (spreadBps > maxDeviationBps) {","if (spreadBps > maxDeviationBps * 100) {","disagreement tolerance widened"),
 ("src/ASOVerifier.sol","Math.Rounding.Ceil","Math.Rounding.Floor","spread rounding flipped"),
 ("src/ASOVerifier.sol","if (a.nonce != nonce) revert NonceMismatch(i);","","per-attestation nonce check removed"),
 ("src/ASOSentinel.sol","if (!has) return Reason.FEED_STALE;","","adapter staleness ignored"),
 ("src/ASOSentinel.sol","if (accepted > restrictedAtNonce) {","if (true) {","recovery gate removed"),
 ("src/ASOSentinel.sol","newLine = Math.min(ilkDebt() + gap, maxLine);","newLine = ilkDebt() + gap;","maxLine cap removed"),
 ("src/ASOSentinel.sol","uint256 newLine = 0; // any non-HEALTHY outcome closes the ceiling","uint256 newLine = ilkDebt(); // MUTANT: cap at current debt","restrict to current debt instead of 0"),
 ("src/ASOSentinel.sol","if (vatPrice() * BPS > verifier.price() * (BPS + maxPriceGapBps)) return Reason.VAT_PRICE_ABOVE_ATTESTED;","","overvaluation check removed"),
 ("src/ASOSentinel.sol","if (s == ASOVerifier.Status.DISPUTED) return Reason.ASO_DISPUTED;","","dispute ignored"),
 # --- Origin // ASO Sentinel (state machine, risk engine, cost model) ---
 ('src/OriginSentinel.sol', 'next = newRound && waited ? target : State.RECOVERING;', 'next = waited ? target : State.RECOVERING;', 'origin: recovery without new round'),
 ('src/OriginSentinel.sol', 'next = newRound && waited ? target : State.RECOVERING;', 'next = newRound ? target : State.RECOVERING;', 'origin: recovery without delay'),
 ('src/OriginSentinel.sol', '        } else if (cur == State.DISPUTED || cur == State.PROTECTIVE) {\n            next = State.RECOVERING;', '        } else if (cur == State.DISPUTED || cur == State.PROTECTIVE) {\n            next = target;', 'origin: direct escape from restriction'),
 ('src/OriginSentinel.sol', 'if (isRestricted(s)) return 0;', 'if (s == State.PROTECTIVE) return 0;', 'origin: restricted states keep headroom'),
 ('src/OriginSentinel.sol', 'return Math.min(line, epochStartDebt + epochConfig.growthCap);', 'return line;', 'origin: epoch cap removed'),
 ('src/OriginSentinel.sol', 'uint256 g = s == State.WATCH ? limits.gap * limits.watchGapBps / BPS : limits.gap;', 'uint256 g = limits.gap;', 'origin: WATCH opens full headroom'),
 ('src/OriginSentinel.sol', '        epochStartDebt = ilkDebt();\n        emit EpochStarted', '        emit EpochStarted', 'origin: epoch baseline never refreshed'),
 ('src/OriginSentinel.sol', 'f |= F_VAT_ABOVE_EFFECTIVE;', '{}', 'origin: Vat-above-effective ignored'),
 ('src/OriginSentinel.sol', 'if (dev >= t.twapProtectBps) f |= F_TWAP_DEVIATION_PROTECT;', 'if (false) {}', 'origin: TWAP protect ignored'),
 ('src/OriginSentinel.sol', 'if (vel >= t.velocityProtectBpsPerHour) f |= F_VELOCITY_PROTECT;', 'if (false) {}', 'origin: velocity protect ignored'),
 ('src/OriginSentinel.sol', 'if (c == CostModel.Concern.HIGH) f |= F_COST_HIGH;', 'if (false) {}', 'origin: cost HIGH ignored'),
 ('src/OriginSentinel.sol', '            restrictedAtNonce = verifier.lastNonce();\n        } else if', '        } else if', 'origin: restriction nonce not recorded'),
 ('src/risk/ASORiskEngine.sol', 'if (tOk && t < spot) return (t, true);', '', 'engine: effective price ignores TWAP'),
 ('src/risk/ASORiskEngine.sol', 'ok = coverageBps >= minCoverageBps;', 'ok = true;', 'engine: TWAP coverage not required'),
 ('src/risk/ASORiskEngine.sol', 'if (accepted == 0 || accepted == lastRecordedNonce) return false;', 'if (accepted == 0) return false;', 'engine: duplicate observations'),
 ('src/risk/ASORiskEngine.sol', 'if (!verifier.isSigner(signer)) revert NotAnAuthorisedSource(signer);', '', 'engine: source authorisation skipped'),
 ('src/risk/ASORiskEngine.sol', 'if (signer <= prev) revert SignersNotStrictlyAscending(i);', '', 'engine: duplicate sources allowed'),
 ('src/risk/CostModel.sol', 'q.costUsd = q.capitalUsd * deviationBps * p.lossShareBps / (BPS * BPS);', 'q.costUsd = q.capitalUsd;', 'cost: loss model replaced by capital'),
 ('src/risk/WeightedMedian.sol', 'if (acc * 2 >= total) return prices[i];', 'if (acc >= total) return prices[i];', 'median: returns maximum instead'),
]
res=[]
for f,old,new,name in muts:
    src=open(f,encoding='utf-8').read().replace('\r\n','\n')
    if old not in src: res.append((name,"PATTERN NOT FOUND")); continue
    shutil.copy(f,f+".bak")
    open(f,'w',encoding='utf-8').write(src.replace(old,new,1))
    try:
        p=subprocess.run(["forge","test","--no-match-contract","SentinelInvariantsTest","--fuzz-runs","64"],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600)
        out=p.stdout+p.stderr
        import re
        m=re.search(r"(\d+) tests passed, (\d+) failed",out)
        if "Compiler run failed" in out or "Error" in out and not m: res.append((name,"COMPILE ERROR"))
        else: res.append((name, f"KILLED ({m.group(2)} failing tests)" if m and int(m.group(2))>0 else "SURVIVED"))
    finally:
        shutil.move(f+".bak",f)
for n,r in res: print(f"{r:28s} <- {n}")
killed=sum(1 for _,r in res if r.startswith("KILLED"))
print(f"{killed}/{len(res)} mutants killed")
if killed != len(res):
    print("FAIL: every mutant must be killed (a survivor means a security check is untested)")
    sys.exit(1)
