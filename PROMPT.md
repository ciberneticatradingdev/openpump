# PROMPT — Clone the pump.fun ecosystem (pump + PumpSwap + pump_fees) into a rebranded, better launchpad

You are an autonomous engineering agent with a Linux x86-64 machine (Ubuntu 24.04), Docker, ~16 GB RAM, network access, and a funded Solana devnet wallet. Work in `~/Desktop/coding/openpump`. The folder already contains `evidence/`:

- `evidence/pump.so` — mainnet bytecode of `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (1,934,800 bytes, trimmed ELF, unverified on osec)
- `evidence/pump_amm.so` — mainnet bytecode of `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (1,268,504 bytes)
- `evidence/pump.json`, `pump_amm.json`, `pump_fees.json` — official Anchor IDLs from github.com/pump-fun/pump-public-docs (56 / 38 / 31 instructions, 110 / 88 / 37 error codes, full account + event layouts)

Also dump `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` (pump_fees) the same way (`solana program dump`, then trim to ELF section-header end).

Reference for method: https://github.com/lalalune/daosfun-source (Shaw's byte-identical recovery of daos.fun, 1.04 MB ELF → 60 Rust files / 129 KB). Read its `docs/BUILD.md`, `repro/`, `scripts/setup_repro.py`, `scripts/build_exact.py` first and reuse the pipeline. Key facts from it: official Anza platform-tools v1.41 (rustc 1.75.0-dev, LLVM 17.0.6, target `sbf-solana-solana`), Anchor 0.30.1, solana-program 1.18.26, release profile with overflow-checks on, LTO off, codegen-units 1, recovered linker section ordering applied post-compile, and panic line/column strings embedded in the binary must match the recovered source layout.

## Ground rules

1. **Never deploy a byte-identical copy of pump.fun's binary to mainnet as our product.** The byte-identical rebuild is Phase A: a proof and a spec. The product (Phase B onward) is a clean-room reimplementation we own, with our own program IDs, authorities, fee recipients, constants and brand. Document every place where Phase B logic was derived from Phase A so a lawyer can review provenance.
2. Everything that touches real funds ships only after the Phase D audit gate.
3. Commit after every phase. Write `STATUS.md` at the root and update it at each gate with what is proven, what is assumed, and the exact commands to reproduce.
4. Do not stop at a partial phase. If a phase cannot be completed, finish every independent piece of it, then write the blocker in `STATUS.md` with the exact error and continue with the next phase that does not depend on it.

## Phase A — Recover source (reference + proof that "no security by obscurity" is real)

A1. Toolchain: install platform-tools v1.41 exactly as Shaw's `setup_repro.py` does. Confirm `cargo-build-sbf --version` reports rustc 1.75.0-dev. Fingerprint the three binaries: list every embedded string matching `programs/.*\.rs`, `src/.*\.rs`, crate names and versions, panic messages, seeds (`"bonding-curve"`, `"global"`, `"creator-vault"`, `"pool"`, `"user_volume_accumulator"`, etc.), and every 32-byte constant that decodes to a valid base58 pubkey (those are hardcoded program IDs, fee recipients, admin keys and mints: table them in `recovery/constants.md`).

A2. Reconstruct the crate tree from embedded paths. From `pump.so` we already know: `programs/pump/src/{lib,buy,buy_v*,sell,sell_v*,create_v*,migrate,migrate_v*,multi_hop_curve_swap,pump_quote,extend_account,fee_recipient,admin_set_idl_authority,set_reserved_fee_recipients}.rs`, `creator/{admin_cto,collect_creator_fee,distribute_creator_fees,distribute_creator_fee_v*,distribute_fee_to_holders,migrate_bonding_curve_creator,set_creator,set_metaplex_creator}.rs`, `quote_control/{initialize_quote_control,state,update_quote_control_mints}.rs`. From `pump_amm.so`: `programs/pump-amm/src/curve/{constant_product,fees}.rs`, `instructions/{admin/*,boost,coin_creator/*,create_pool,extend_account,liquidity/{deposit,withdraw},swap/{buy,sell,multi_hop_swap,trade_v*,mod},sweep_fees,token_incentives/claim}.rs`. Create every file with the exact relative path (panic strings depend on it).

A3. Disassemble with `llvm-objdump -d` from platform-tools plus `solana-sbpf` disassembler; map each Anchor 8-byte discriminator from the IDL to its handler function. For each instruction write the Rust handler so the Anchor `#[derive(Accounts)]` struct matches the IDL account list byte for byte (order, `mut`, `signer`, PDA seeds, `init`/`init_if_needed`, `realloc`, `close`), the args match the IDL `args`, and the state structs match IDL `accounts`/`types` with identical field order and padding. Events are IDL `events`; error codes are IDL `errors` (keep numbering).

A4. Reconstruct the math in `constant_product.rs` and `fees.rs` from the disassembly, not from memory: virtual-reserve constant product (`tokens_out = vt - (vs*vt)/(vs + sol_in)`), fee basis points, creator-fee split, holder-reward distribution, cashback, token incentives, the volume accumulator, mayhem-mode virtual params, quote-control reserves, the v2/v3 instruction variants (SPL Token vs Token-2022 paths, `buy_exact_quote_in`). Write a property test per formula that replays real mainnet transactions (fetch 200 `buy`/`sell`/`create`/`migrate` txs via `getSignaturesForAddress` + `getTransaction`, decode with the IDL, and assert the recovered program produces identical token/SOL deltas and identical emitted events in a local `solana-test-validator` loaded with the mainnet account state via `--clone`).

A5. Byte-identical gate. Build with Shaw's `build_exact.py` recipe (offline, locked Cargo.lock, recovered section order, official llvm-strip). Diff against `evidence/*.so`. Iterate on: inlining, panic locations, generic instantiation order, `#[inline(never)]`, string literal order. Record SHA-256 of original vs rebuilt in `STATUS.md`. If you cannot reach byte-identity after honest effort, stop at **behavior-identical** (A4 replay suite 100 % green) and say so plainly; the product does not depend on byte-identity.

A6. Security review of the recovered source, Shaw-style (`audit/AUDIT.md`): missing signer/owner checks, PDA seed collisions, arithmetic overflow paths, fee-recipient validation, migration authority, Token-2022 transfer-fee handling, `extend_account` realloc bounds, `admin_cto` paths. Findings are confidential: do not publish or exploit; list them so Phase B fixes them.

## Phase B — Clean-room product: the community launchpad

Working brand (placeholder until the user confirms): **OpenPump** (`openpump`), ticker `$PEOPLE`. Positioning: "the launchpad the community asked for" — built in response to KOLs publicly asking for a new launchpad. Do **not** name the product or any token after a real person without their written consent; reference the community, not individuals.

B1. New Anchor 0.30.1 workspace `programs/{openpump,openpump_amm,openpump_fees}` with fresh program keypairs. Write the code from the Phase A behavior spec, in your own structure and naming, not by renaming Phase A files. Fix every A6 finding. Keep the IDL *shape* compatible with pump's where it costs nothing (so existing trading bots, Jupiter and screeners integrate with a one-line program-ID swap) but change: all seeds prefixes, all hardcoded keys, the fee recipients, the admin/authority keys (multisig via Squads), and the fee schedule.

B2. "Better" is concrete. Implement and default-on:
- Creator fee 50 % of protocol fee from the first trade (pump's is lower and tiered), claimable with no minimum.
- Holder rewards native in the curve (ported from `distribute_fee_to_holders`), snapshot cadence configurable per coin at create.
- Graduation threshold configurable per coin from a fixed menu (equivalent to 60 / 85 / 120 SOL of real reserves), with migration into our own CP-AMM (`openpump_amm`) in the same transaction, LP burned by default.
- Anti-snipe: first N slots after create cap buys per wallet at a percentage of the virtual token reserves; configurable at create.
- Custom quote mints (pump's `quote_control`) so coins can be paired with `$PEOPLE` instead of SOL; the flagship `$PEOPLE` coin receives a protocol-fee share routed through `openpump_fees`.
- Fee program with public `get_fees` view and per-tier config, migrated from pump_fees' structure but with our tiers.

B3. Tests: Anchor TS tests + the A4 replay harness pointed at the new programs (same inputs must produce the spec'd deltas). Fuzz the curve math with `proptest` (no overflow, monotonic price, fee never exceeds input, reserves never negative). Run `cargo audit` and Sec3 X-Ray / `soteria` if available.

## Phase C — Everything around the programs

C1. Indexer: Rust or TypeScript (Helius or Yellowstone gRPC) that decodes our events into Postgres (coins, trades, candles 1s/1m/5m/1h, holders, creator earnings, graduation). Expose REST + WebSocket.
C2. Frontend: Next.js app with create (image + metadata upload to IPFS via Pinata/Irys, Metaplex Token Metadata), trade (buy/sell with slippage, priority fee, Jito tip), coin page with live chart + trades + holders + comments, creator dashboard (claim fees), holder-rewards view, leaderboard, "graduated" tab, wallet-adapter (Phantom, Solflare, Backpack), mobile first. Reuse `~/Desktop/coding/pumpkit` (private, ciberneticatradingdev/pumpkit) for the Solana client helpers and `~/Desktop/coding/robinpump` for the bonding-curve frontend UX patterns.
C3. SDK: `@openpump/sdk` (TypeScript) generated from the IDL with convenience `buy/sell/create/claim` builders, plus a pump-compatible shim so bots can swap `programId` only.
C4. Ops: Railway for indexer + API, Vercel for the frontend, Neon Postgres, Helius RPC, Squads multisig for upgrade authority, program upgrade runbook, `solana-verify` so our programs are **verified builds** on osec from day one (the thing pump never did).

## Phase D — Gates before mainnet

D1. Deploy to devnet, run the full replay + fuzz suite against devnet, run a 48 h soak with a bot creating and trading 200 coins.
D2. External audit of Phase B programs (OtterSec / Sec3 / Zellic); fix all findings; publish the report.
D3. Mainnet deploy with upgrade authority in the Squads multisig, `solana-verify` published, bug bounty page live, kill-switch (`disable` flags, ported from pump_amm) tested on devnet first.
D4. Launch `$PEOPLE` as the first coin on the platform, through the platform.

## Deliverables

`STATUS.md` with reproduction commands and hashes; `recovery/` (Phase A, with `audit/AUDIT.md`); `programs/`, `tests/`, `indexer/`, `web/`, `sdk/`; a one-page `LAUNCH.md` for the community explaining what is different from pump.fun and why, in plain English, with no claims you cannot back with a test or a tx link.
