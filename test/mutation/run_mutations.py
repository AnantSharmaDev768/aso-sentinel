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
]
res=[]
for f,old,new,name in muts:
    src=open(f,encoding='utf-8').read()
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
