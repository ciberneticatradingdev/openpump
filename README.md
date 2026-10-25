# OpenPump

Clean-room launchpad shaped like pump.fun + PumpSwap, on Solana. Four Anchor programs (curve, AMM, fees, mayhem), a TypeScript SDK, an indexer/API server and a web app.

| Piece | Where | What |
|---|---|---|
| Bonding curve | `programs/openpump-curve` | create / buy / buy_exact_sol_in / sell / migrate / collect_creator_fee / set_params · v2 (custom pairs): set_quote_config / create_v2 / buy_v2 / buy_exact_quote_in / sell_v2 / collect_creator_fee_v2 / migrate_v2 · holder rewards: update_holder_reward_config / distribute_fee_to_holders(_v2) |
| AMM | `programs/openpump-amm` | create_config / create_pool / deposit / withdraw / buy / buy_exact_quote_in / sell / collect_coin_creator_fee / disable · multi-hop swap (coin → coin in one route) · trade-to-earn volume tracking (CPI into the curve's shared campaign) · buyback share of the protocol fee · boost (init_boost / boost_buy_and_burn: delayed buy-and-burn on graduation) · mayhem pools · extend_account |
| Fees | `programs/openpump-fees` | fee tiers by market cap, buyback vault, fee-sharing configs (creator splits with shareholders), social fee PDAs, donations, admin CTO |
| Mayhem | `programs/openpump-mayhem` | protocol market-making vault for `is_mayhem_mode` launches: trader buys/sells through the curve within a reference-price band and per-sweep SOL cap, burns leftovers after the window, admin withdraw/sweep |
| SDK | `sdk/` | PDAs, exact on-chain math in BigInt, instruction builders, CPI-event decoding |
| Server | `server/` | SQLite indexer (polls program signatures, decodes `emit_cpi!` events), REST + WebSocket, metadata uploads (Pinata or local) |
| Web | `web/` | Vite + React: board, coin page (chart, trades, holders, trade panel), create, profile, how-it-works |

Program IDs (same on every cluster): curve `AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB`, AMM `BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb`, fees `goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5`, mayhem `Bh6Tz6WwwQbxEAMB2FjkrLWjAXbAxDn3t445jU1pZMAP`.

## What is different from pump.fun

- Creator earns **0.5 %** of every trade from trade #1 (pump: smaller, and only after thresholds). Protocol takes 0.5 %.
- `buy_exact_sol_in`: spend-X-SOL UX on-chain, with partial fill at the end of the curve.
- Anti-snipe window: per-buy cap (1 % of supply) during the first 15 slots after launch.
- Graduation is permissionless, atomic (curve → AMM pool in one tx), **LP burned**, price continuous.
- AMM: 0.2 % LP / 0.05 % protocol / 0.05 % creator; anyone can LP; admin kill-switch per instruction.
- **Custom pairs** (v2 family): coins quoted in any SPL / Token-2022 mint the authority enables, with per-mint virtual reserves; fees and graduation in that token.
- **Holder rewards**: at launch the creator can route the creator fee to holders. Same pattern as pump.fun (the coin's creator is the `["holder-rewards", mint]` PDA); a configured authority pays the top holders pro-rata via `distribute_fee_to_holders`. The server's crank does this every few minutes (`HOLDER_REWARD_AUTHORITY_KEYPAIR`).
- **Boost** (PumpSwap's init_boost / boost_buy_and_burn): right after graduation 20 % of the pool's quote moves into a boost vault while the pool keeps pricing it as virtual quote (no price move, LP moves locked). The boost authority then spends it on buy-and-burns; the vault closes when empty.
- **Trade-to-earn covers the AMM too**: an AMM buy with `track_volume` CPIs into the curve program (signed by the AMM's volume-tracker PDA), so curve and AMM volume share one campaign and one claim. The buyback share of the AMM protocol fee lands in the fees program's vault as quote tokens (`sweep_buyback_quote`).
- Not cloned on purpose: cashback (pump deprecated it), `sweep_*` / `transfer_creator_fees_to_pump` (our fees leave the pool on every trade instead of accruing inside it), `migrate_pool_coin_creator` (legacy layout), reserved fee recipients (integrator whitelist), the `_v2` instruction family (our single family already reads the fee config and holder-reward flags).
- **Mayhem mode**: a launch flag (`create` / `create_v3`, not custom pairs) that starts the coin from the mayhem virtual reserves and lets the protocol vault market-make it for a fixed window (`MAYHEM` demo coin in the local seed).
- Everything verified by tests: `cargo test` (math) + 54 Anchor integration tests covering the full lifecycle, custom pairs, holder rewards, incentives (curve + AMM), fee tiers, sharing, Token-2022, multi-hop, mayhem, buyback and boost.

## Build & test

```bash
./scripts/build.sh            # anchor build with platform-tools v1.54 + IDL/types (see script for why)
anchor test --skip-build      # 54 integration tests on a local validator (Metaplex preloaded from tests/fixtures)
cargo test --lib              # curve + AMM math unit tests
```

## Run locally (seeded)

```bash
./scripts/localnet.sh &                                   # validator with all four programs + Metaplex
cp server/.env.example server/.env                        # RPC_URL=http://127.0.0.1:8899
pnpm --filter @openpump/server start &                   # API on :8787
RPC_URL=http://127.0.0.1:8899 pnpm --filter @openpump/server exec tsx src/seed.ts   # init + 5 coins, one graduates
pnpm --filter @openpump/web dev                          # http://localhost:5173 (proxies /api, /ws, /uploads)
```

## Deploy

1. `anchor deploy --provider.cluster devnet` (deployer `~/.config/solana/id.json` = `INITIAL_AUTHORITY` in both programs; ~7 SOL).
2. `RPC_URL=https://api.devnet.solana.com pnpm --filter @openpump/server admin:init` → creates AMM config + curve Global with `DEFAULT_PARAMS`.
3. Server → Railway (root `railway.json`, volume at `/data`, env from `server/.env.example`). Web → Vercel (`web/vercel.json`, env `VITE_API_URL`).

Before mainnet: move upgrade authority + `INITIAL_AUTHORITY` to a Squads multisig, run `solana-verify`, external audit. See `PROMPT.md` for the full plan and `evidence/` for the pump.fun bytecode + IDLs this was shaped after.

## Reference

`../pumpfun-source-ref` (lalalune/pumpfun-source, sparse clone) holds the community's bytecode-level recovery of pump.fun's programs. We use it as the behavioural spec for parity work and never copy its code (it has no license and is reconstructed from pump's binary).
