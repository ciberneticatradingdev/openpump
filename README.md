# OpenPump

**pump.fun, open and better.** A clean-room, open-source launchpad for Solana: bonding curve, AMM, fee engine and market-making vault, written from scratch to match what pump.fun and PumpSwap do today, then go further.

> Status: **code complete, pre-mainnet.** Four Anchor programs, a TypeScript SDK, an indexer/API and a web app. 54 integration tests pass on a local validator. Nothing is on mainnet yet. See the [roadmap](ROADMAP.md) for how we get there, and [docs/PARITY.md](docs/PARITY.md) for a feature-by-feature comparison with pump.fun.

---

## Why

pump.fun is closed source, upgradeable by one party, and keeps the entire fee stream. Every launchpad that tried to replace it so far either forked an older design or bolted a token onto someone else's contracts.

OpenPump is the full stack, in the open:

- **Same mechanics people already know.** Bonding curve with virtual reserves, graduation into a constant-product AMM with burned LP, creator fees from trade #1, custom pairs, holder rewards, trade-to-earn, fee tiers by market cap, fee sharing, social and charity fees, Token-2022, multi-hop swaps, mayhem mode, boost buy-and-burn.
- **Owned by the people using it.** Upgrade authority goes to a multisig, fee parameters are on-chain and public, and the protocol's buyback share flows to the community token, $OPENPUMP.
- **Built to be forked, audited and integrated.** Public IDLs, a typed SDK, an indexer anyone can run, and a reference web app.

## What's in the repo

| Piece | Where | What |
|---|---|---|
| Bonding curve | `programs/openpump-curve` | create / buy / buy_exact_sol_in / sell / migrate / creator fees · custom pairs (any SPL or Token-2022 quote) · holder rewards · volume incentives · Token-2022 launches (`create_v3`) · mayhem launches · admin CTO · `extend_account` |
| AMM | `programs/openpump-amm` | create_pool / deposit / withdraw / buy / buy_exact_quote_in / sell · multi-hop (coin → coin in one instruction) · trade-to-earn on AMM volume · buyback share of the protocol fee · boost (delayed buy-and-burn at graduation) · mayhem pools · kill switch · `extend_account` |
| Fees | `programs/openpump-fees` | market-cap fee tiers · creator fee sharing (split with shareholders) · social fee PDAs (fees for an X handle, claimed by its verified wallet) · donation PDAs · buyback vaults · admin CTO |
| Mayhem | `programs/openpump-mayhem` | protocol market-making vault: trades mayhem-mode coins inside a price band with a per-sweep cap, burns what it holds after the window |
| Shared types | `crates/openpump-fee-types` | FeeConfig / SharingConfig / tier selection, read by every program |
| SDK | `sdk/` | PDAs, exact on-chain math in BigInt, instruction builders for every instruction, event decoding |
| Server | `server/` | SQLite indexer (decodes `emit_cpi!` events from all four programs), REST + WebSocket, metadata uploads, cranks (holder payouts, donations) |
| Web | `web/` | Vite + React: board, coin page (chart, trades, holders, trade panel), create, swap, profile |

Program IDs are fixed across clusters:

| Program | ID |
|---|---|
| Curve | `AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB` |
| AMM | `BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb` |
| Fees | `goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5` |
| Mayhem | `Bh6Tz6WwwQbxEAMB2FjkrLWjAXbAxDn3t445jU1pZMAP` |

## Roadmap at a glance

Full version with milestones and definitions of done: **[ROADMAP.md](ROADMAP.md)**.

| Phase | Goal | Status |
|---|---|---|
| 0 · Build | Clean-room programs at parity with pump.fun, tested | ✅ done |
| 1 · $OPENPUMP | Launch the community token on pump.fun, validate demand, fund the treasury | next |
| 2 · OpenSwap | The AMM on mainnet under a multisig, verified build, swap UI | |
| 3 · First launch | The bonding curve on mainnet; the first coin launched and graduated on OpenPump | |
| 4 · Full launchpad | Custom pairs quoted in $OPENPUMP, holder rewards, trade-to-earn, fee tiers, sharing, social fees, mayhem, boost | |
| 5 · Harden | External audit, bug bounty, verified builds, multisig governance of fee parameters | |
| 6 · Ecosystem | Public API, bots and terminals, integrations, mobile | |

## How $OPENPUMP fits

$OPENPUMP is the community token, not a governance promise. Its on-chain hooks are already in the code:

- **Buyback share.** The fees program has buyback vaults; the curve and the AMM route a configurable share of the protocol fee into them. The vault authority spends it on $OPENPUMP.
- **Quote mint.** Custom pairs let coins trade against any mint the protocol enables. $OPENPUMP as a quote mint means every coin launched that way is bought with $OPENPUMP.
- **Trade-to-earn.** Volume campaigns pay traders in a configured mint; $OPENPUMP is the natural one.

Treasury wallet, fee parameters and multisig signers will be published on-chain and in this README before mainnet.

## Build, test, run

```bash
./scripts/build.sh            # anchor build with platform-tools v1.54 (edition-2024 crates) + IDLs/types
anchor test --skip-build      # 54 integration tests on a local validator (Metaplex preloaded from tests/fixtures)
cargo test --lib              # math unit tests
```

Local stack with seeded data (coins, a graduated pool with a live boost, a holder-rewards coin, a custom pair, a mayhem coin):

```bash
./scripts/localnet.sh &                                   # validator with all four programs + Metaplex
cp server/.env.example server/.env                        # RPC_URL=http://127.0.0.1:8899
pnpm --filter @openpump/server start &                   # API on :8787
RPC_URL=http://127.0.0.1:8899 pnpm --filter @openpump/server exec tsx src/seed.ts
pnpm --filter @openpump/web dev                          # http://localhost:5173
```

Deploy: `anchor deploy --provider.cluster <cluster>`, then `pnpm --filter @openpump/server admin:init` (creates the AMM config and curve Global) and `admin:fees`. Server runs on Railway (`railway.json`, volume at `/data`), web on Vercel (`web/vercel.json`, `VITE_API_URL`).

## Design notes

- **Clean room.** The programs were written from the public behaviour of pump.fun and PumpSwap (IDLs, on-chain events, the community's bytecode recovery in `lalalune/pumpfun-source`). No code was copied; seeds, authorities, layouts and fee math are our own. `evidence/` keeps the public IDLs we shaped the interfaces after.
- **Fees leave the pool on every trade** (protocol, creator, buyback) instead of accruing inside it, so there is nothing to sweep and nothing to drain.
- **One trade-to-earn campaign** covers curve and AMM volume: an AMM buy CPIs into the curve's accumulator, signed by the AMM's tracker PDA. One claim for the user.
- **Boost without moving the price.** At graduation part of the pool's quote is parked in a vault but still counted as virtual reserves; the boost authority spends it on buy-and-burns, LP moves are locked until the vault is empty.
- **Account extension** instructions on curve and AMM let old accounts grow into new layouts without migrations.

What we deliberately did not clone and why: [docs/PARITY.md](docs/PARITY.md).

## Security

Not audited. Do not put money you cannot lose into contracts that have not been audited, including these. See [SECURITY.md](SECURITY.md) for the disclosure process and what is planned before mainnet.

## Contributing

Issues and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: SDK examples, indexer performance, UI polish, test coverage for edge cases.
