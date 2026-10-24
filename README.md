# OpenPump (working name)

Clean-room launchpad shaped like pump.fun + PumpSwap, on Solana. Two Anchor programs, a TypeScript SDK, an indexer/API server and a web app.

| Piece | Where | What |
|---|---|---|
| Bonding curve | `programs/openpump-curve` | create / buy / buy_exact_sol_in / sell / migrate / collect_creator_fee / set_params |
| AMM | `programs/openpump-amm` | create_config / create_pool / deposit / withdraw / buy / sell / collect_coin_creator_fee / disable |
| SDK | `sdk/` | PDAs, exact on-chain math in BigInt, instruction builders, CPI-event decoding |
| Server | `server/` | SQLite indexer (polls program signatures, decodes `emit_cpi!` events), REST + WebSocket, metadata uploads (Pinata or local) |
| Web | `web/` | Vite + React: board, coin page (chart, trades, holders, trade panel), create, profile, how-it-works |

Program IDs (same on every cluster): curve `AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB`, AMM `BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb`.

## What is different from pump.fun

- Creator earns **0.5 %** of every trade from trade #1 (pump: smaller, and only after thresholds). Protocol takes 0.5 %.
- `buy_exact_sol_in`: spend-X-SOL UX on-chain, with partial fill at the end of the curve.
- Anti-snipe window: per-buy cap (1 % of supply) during the first 15 slots after launch.
- Graduation is permissionless, atomic (curve → AMM pool in one tx), **LP burned**, price continuous.
- AMM: 0.2 % LP / 0.05 % protocol / 0.05 % creator; anyone can LP; admin kill-switch per instruction.
- Everything verified by tests: `cargo test` (math) + 15 Anchor integration tests covering the full lifecycle.

## Build & test

```bash
./scripts/build.sh            # anchor build with platform-tools v1.54 + IDL/types (see script for why)
anchor test --skip-build      # 15 integration tests on a local validator (Metaplex preloaded from tests/fixtures)
cargo test --lib              # curve + AMM math unit tests
```

## Run locally (seeded)

```bash
./scripts/localnet.sh &                                   # validator with both programs + Metaplex
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
