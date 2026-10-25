# OpenPump roadmap

From a token on pump.fun to a fully open launchpad. Each phase has a goal, concrete deliverables, and a definition of done. Phases run in order; a phase ships when its definition of done is met, not on a date.

Progress is tracked with checkboxes here and in GitHub issues tagged `phase-N`.

---

## Phase 0 · Build ✅

**Goal.** A clean-room implementation of everything pump.fun and PumpSwap do today, tested end to end.

- [x] Bonding curve program: create / buy / sell / migrate, creator fees, anti-snipe window, partial fills at the end of the curve
- [x] AMM program: pools, deposit / withdraw, buy / sell, LP burned at graduation, kill switch
- [x] Custom pairs: coins quoted in any SPL or Token-2022 mint with their own virtual reserves
- [x] Holder rewards: creator fee routed to top holders, paid by a crank
- [x] Trade-to-earn: 30-day volume campaigns paid in a configured mint, curve and AMM volume in one campaign
- [x] Fees program: market-cap fee tiers, creator fee sharing, social fee PDAs, donation PDAs, buyback vaults
- [x] Admin CTO (community takeover of a coin's creator) on curve and AMM
- [x] Token-2022 launches with on-mint metadata (`create_v3`)
- [x] Multi-hop swaps (coin → coin in one instruction)
- [x] Mayhem mode: protocol market-making vault with price band, sweep cap and end-of-window burn
- [x] Boost: delayed buy-and-burn at graduation (`init_boost` / `boost_buy_and_burn`)
- [x] `extend_account` on curve and AMM for layout upgrades
- [x] SDK, indexer, API, web app, seed scripts
- [x] 54 integration tests, math unit tests

**Done when:** every feature in [docs/PARITY.md](docs/PARITY.md) marked "done" has a passing test. ✅

---

## Phase 1 · $OPENPUMP on pump.fun

**Goal.** Validate that people want an open launchpad, build the community, and fund the treasury that pays for everything after. Launching on pump.fun itself is deliberate: it is where the audience is, and it proves the thesis in front of them.

- [ ] Launch $OPENPUMP on pump.fun (ticker, image, this repo as the link)
- [ ] Publish the treasury wallet: creator fees from $OPENPUMP go there, every outflow is listed in `TREASURY.md`
- [ ] Make this repository public with a license, the roadmap and the parity matrix
- [ ] X account and Telegram; weekly build updates linked to commits
- [ ] Testnet playground: the full launchpad on devnet with a faucet so the community can launch and trade test coins and file bugs
- [ ] Bug reports from the playground triaged into Phase 2 and 3 issues

**Done when:** the treasury holds enough to deploy the AMM (about 12 SOL) and at least 100 people have used the devnet playground.

---

## Phase 2 · OpenSwap: the AMM on mainnet

**Goal.** The first OpenPump program on mainnet: a PumpSwap-class AMM anyone can create pools on, with the upgrade key out of a single person's hands from day one.

- [ ] Deploy `openpump-amm` to mainnet (binary ~670 KB, about 5.6 SOL of rent with headroom)
- [ ] Upgrade authority transferred to a Squads multisig; signers published
- [ ] `solana-verify` reproducible build; verified-build badge in the README
- [ ] AMM config: 0.20 % LP / 0.05 % protocol / 0.05 % coin creator; 20 % of the protocol fee to the buyback vault
- [ ] Swap UI on mainnet: swap, pool page, add / remove liquidity, creator fee claims
- [ ] Indexer and public API on mainnet
- [ ] $OPENPUMP / SOL pool on OpenSwap seeded from the treasury
- [ ] First buyback of $OPENPUMP executed from the vault, transaction linked in `TREASURY.md`

**Done when:** a third party has created a pool and traded on it without our help, and the first buyback is on-chain.

---

## Phase 3 · First launch on OpenPump

**Goal.** The bonding curve on mainnet, graduating into OpenSwap. The first coin created, traded and graduated entirely on OpenPump.

- [ ] Deploy `openpump-curve` and `openpump-fees` to mainnet under the same multisig
- [ ] Curve parameters published: 30 SOL / 1.073 B virtual reserves, 793.1 M real tokens, graduation at ~85 SOL, 0.5 % protocol + 0.5 % creator
- [ ] Launch page live: image / metadata upload, create, buy, sell, graduate, claim
- [ ] Creator fee claims and the trade-to-earn claim page
- [ ] A community launch event: the first coin on the curve, migration into OpenSwap, LP burned, transaction links published
- [ ] Holder-rewards crank and donation crank running on the server

**Done when:** at least one coin launched by someone outside the team has graduated into OpenSwap.

---

## Phase 4 · The full launchpad

**Goal.** Turn on every feature that is already in the code, with $OPENPUMP at the center.

- [ ] Custom pairs: $OPENPUMP enabled as a quote mint; launch pages let creators choose SOL or $OPENPUMP
- [ ] Holder rewards toggle on the launch page
- [ ] Trade-to-earn: the first 30-day campaign paid in $OPENPUMP, covering curve and AMM volume
- [ ] Fee tiers by market cap live (lower fees as coins grow)
- [ ] Fee sharing: creators split fees with partners on-chain
- [ ] Social fees: coins launched for an X handle, claimed by the verified wallet (X OAuth on the server)
- [ ] Donation launches: fees to a published beneficiary
- [ ] Token-2022 launches
- [ ] Coin → coin swaps in the UI (multi-hop)
- [ ] Mayhem mode launches with the protocol vault
- [ ] Boost at graduation enabled
- [ ] Admin CTO process documented (how a community requests a takeover)

**Done when:** every row in [docs/PARITY.md](docs/PARITY.md) marked "done" is reachable from the mainnet UI.

---

## Phase 5 · Harden and decentralize

**Goal.** Make it safe to hold size on OpenPump.

- [ ] External audit of the four programs; report published in `audit/`
- [ ] Bug bounty funded from the treasury
- [ ] Multisig expanded to community signers; fee parameter changes announced with a timelock
- [ ] Incident runbook: kill switch owners, pause procedure, communication channel
- [ ] Program upgrade policy: every upgrade is a verified build announced in advance

**Done when:** audit findings are closed and the upgrade policy has been followed for at least one upgrade.

---

## Phase 6 · Ecosystem

**Goal.** Let other people build on OpenPump.

- [ ] Public SDK release on npm with examples (launch, trade, index events)
- [ ] Public API with rate limits and WebSocket streams
- [ ] Integrations: trading bots, terminals and screeners (Telegram bot reference implementation)
- [ ] Livestream per coin
- [ ] Mobile-first web and a PWA
- [ ] Grants from the treasury for community tooling

**Done when:** at least three third-party integrations use the SDK or API in production.

---

## Not on the roadmap (on purpose)

- **Cashback.** pump.fun deprecated it; we did not port a dead feature.
- **Fees accruing inside pools.** Our fees leave the pool on every trade; there is no `sweep_*` and nothing to drain.
- **Legacy layout migrations** (`migrate_pool_coin_creator`, the `_v2` AMM family). Fresh programs do not carry them.
- **Reserved fee recipients** (integrator whitelist). Can be added if an integrator needs it.
