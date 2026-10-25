# Security

## Status

OpenPump has **not been audited**. The programs are tested (54 integration tests, math unit tests) but no third party has reviewed them. Until Phase 5 of the [roadmap](ROADMAP.md) is complete, treat every deployment as experimental.

## Reporting a vulnerability

Please do not open a public issue for anything that could be exploited.

- Email the maintainers at the address listed on the GitHub organisation profile, or DM the project's X account. Include steps to reproduce and, if you have one, a failing test.
- You will get an acknowledgement within 48 hours and a fix timeline within 7 days.
- Once a bug bounty is funded (Phase 5), valid reports are paid from the treasury according to severity. Until then, credit in the changelog and our thanks.

## What is planned before mainnet

- Upgrade authority of every program in a Squads multisig with published signers.
- Reproducible builds verified with `solana-verify`; the on-chain hash is listed in the README.
- Kill switches: the AMM `disable` flags and the curve `paused` flag, with a published pause procedure.
- External audit, report published in `audit/`.

## Scope

In scope: the four programs under `programs/`, the shared crate under `crates/`, and the SDK's math under `sdk/src/math.ts` (clients rely on it for quotes).

Out of scope until they are deployed to mainnet: the indexer, the web app, and the cranks.
