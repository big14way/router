# Deviations from BUILD.md

Each entry records where live documentation or observed behaviour differed from BUILD.md, and what the template does instead. Dates are when the conflict was observed.

## D-1 (2 Oct 2026) — Gas billing: no 80% minimum charge

**BUILD.md §3** says "Gas: ≥80% of gas limit is charged; set realistic limits."
**Live docs** (https://docs.hedera.com/evm/development/gas-fees.md): "Following HIP-1249, Hedera has ... eliminated minimum gas charges" and "Users are charged only for the actual gas used during transaction execution, with unused gas being fully refunded."
**What we do:** keep realistic gas limits anyway (the 15M per-transaction cap still applies and Hashio rejects oversized limits), but documentation and the UI do not claim an 80% floor.

## D-2 (2 Oct 2026) — `LICENSE` filename

The blank template ships `LICENCE`. BUILD.md §4 and the bounty gate expect `LICENSE`. Renamed, MIT text kept, copyright lines extended.

## D-3 (2 Oct 2026) — Commit attribution

No co-author trailers are added to commits, at the repository owner's request.
