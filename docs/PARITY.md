# Parity with pump.fun / PumpSwap

Feature-by-feature comparison against pump.fun's current programs (pump, pump_amm, pump_fees). "Done" means implemented in OpenPump with a passing integration test. Instruction names differ on purpose; this is a clean-room implementation shaped after public behaviour, not a copy.

Legend: ✅ done · 🔶 partial / different design · ⏭ skipped on purpose · ⬜ not yet

## Bonding curve

| Feature | pump.fun | OpenPump | Notes |
|---|---|---|---|
| Launch with Metaplex metadata | create | ✅ `create` | mint authority revoked, full supply on the curve |
| Launch on Token-2022, on-mint metadata | create_v3 | ✅ `create_v3` | update authority dropped |
| Launch quoted in a custom mint | create_v2 | ✅ `create_v2` | any SPL / Token-2022 quote enabled by the authority |
| Buy exact tokens out | buy / buy_v3 | ✅ `buy` | |
| Spend exact SOL in, partial fill at the end | buy_exact_sol_in | ✅ `buy_exact_sol_in` | |
| Sell | sell / sell_v3 | ✅ `sell` | |
| Custom-pair buys / sells | buy_v2, buy_exact_quote_in(_v2/_v3), sell_v2 | ✅ `buy_v2`, `buy_exact_quote_in`, `sell_v2` | one family reads the fee config |
| Graduation into the AMM, LP burned | migrate | ✅ `migrate`, `migrate_v2` | atomic CPI into the AMM, price continuous |
| Creator fee from trade #1 | collect_creator_fee | ✅ `collect_creator_fee`, `_v2` | 0.5 % protocol + 0.5 % creator by default |
| Creator-set fee within a ceiling | set_creator_fee_bps | ✅ `set_creator_fee_bps` | lockable |
| Holder rewards (fee to top holders) | holder-rewards PDA + distribute_fee_to_holders | ✅ same pattern | crank in `server/src/crank.ts` |
| Trade-to-earn volume campaigns | *_user_volume_accumulator, claim_token_incentives | ✅ | AMM volume CPIs into the same campaign |
| Anti-snipe window | first-slot caps | ✅ per-buy cap during the opening slots | |
| Admin community takeover | admin_cto | ✅ `admin_cto` | to a wallet or to holder rewards |
| Mayhem launches | is_mayhem_mode, toggle_mayhem_mode + the mayhem program | ⏭ | protocol market-making vault: OpenPump does not trade its own coins |
| Quote mint registry | add/remove_quote_mint, quote control | 🔶 `set_quote_config` | enable flag + reserves per mint; no delegated quote-control admin |
| Account layout upgrades | extend_account | ✅ `extend_account` | Global and BondingCurve |
| Cashback | claim_cashback, toggle_cashback_enabled | ⏭ | deprecated by pump (create_v2 rejects it) |
| Fees accrued inside the curve, swept later | sweep_creator_fee, sweep_protocol_fee | ⏭ | our fees leave the curve on every trade |
| Curve → curve in one instruction | multi_hop_curve_swap | 🔶 | the SDK routes curve legs as separate instructions in one transaction |
| Metaplex creator field, max curve depth, reserved fee recipients, IDL authority | misc admin | ⬜ | cosmetic / admin; add on demand |

## AMM (PumpSwap)

| Feature | PumpSwap | OpenPump | Notes |
|---|---|---|---|
| Pools, deposit, withdraw | create_pool, deposit, withdraw | ✅ | minimum liquidity locked forever |
| Buy exact base out / sell | buy, sell (+_v2) | ✅ `buy`, `sell` | |
| Spend exact quote in | buy_exact_quote_in (+_v2) | ✅ `buy_exact_quote_in` | |
| LP / protocol / creator fee split | global config | ✅ 0.20 / 0.05 / 0.05 % | tiered when the fees program is present |
| Coin creator fee vault and claim | collect_coin_creator_fee | ✅ | |
| Trade-to-earn on AMM volume | own accumulators | 🔶 CPI into the curve's campaign | one campaign, one claim |
| Multi-hop swap | multi_hop_swap | ✅ | up to 4 legs |
| Boost (delayed buy-and-burn) | init_boost, boost_buy_and_burn | ✅ | virtual quote reserves, LP locked while in flight |
| Buyback share of the protocol fee | update_buyback_config | ✅ | to the fees program's vault, as quote tokens |
| Mayhem pools | toggle_mayhem_mode, is_mayhem_mode | ⏭ | see curve |
| Admin CTO on a pool | admin_cto_pool | ✅ | |
| Creator fee sharing on AMM fees | sharing config as coin creator | ✅ `distribute_coin_creator_fees` | |
| Kill switch per instruction | disable | ✅ | |
| Account layout upgrades | extend_account | ✅ | GlobalConfig and Pool |
| Fees accrued inside the pool, swept later | sweep_*, transfer_creator_fees_to_pump | ⏭ | fees leave the pool on every trade |
| Cashback | claim_cashback | ⏭ | deprecated |
| Legacy migrations | migrate_pool_coin_creator | ⏭ | fresh program |
| Reserved fee recipients | set_reserved_fee_recipients | ⬜ | integrator whitelist; on demand |

## Fees program

| Feature | pump_fees | OpenPump | Notes |
|---|---|---|---|
| Market-cap fee tiers | fee config | ✅ | read by curve and AMM |
| Creator fee sharing config | sharing config | ✅ | shareholders in bps |
| Social fee PDAs (fees for an X handle) | social fee PDA | ✅ | claim authority pays the verified wallet; OAuth on the server in Phase 4 |
| Donation PDAs | donation fee PDA + crank | ✅ | |
| Buyback vaults | buyback vault | ✅ | SOL and quote-token sweeps |
| Admin CTO via the fees program | admin_cto | ✅ | |
| Stable-quote tier table | upsert_stable_fee_tiers | 🔶 | tiers are selected per quote mint already; no separate stable table |
| View helpers | get_fees_with_quote_mint, get_minimum_distributable_fee | ⬜ | the SDK computes these client-side |
| Layout upgrades | extend_fee_config | ⬜ | |

## Test coverage

50 Anchor integration tests (`tests/openpump.ts`) exercise every ✅ row above on a local validator, plus Rust unit tests for the curve and AMM math. Run `anchor test --skip-build` after `./scripts/build.sh`.
