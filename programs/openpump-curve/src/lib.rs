//! OpenPump — bonding-curve launchpad.
//!
//! Clean-room implementation shaped like pump.fun's public IDL (create / buy / sell /
//! migrate / collect_creator_fee / set_params) with our own seeds, authorities, fee
//! schedule and extras:
//!   * creator earns `creator_fee_bps` of every trade from trade #1, claimable any time
//!   * anti-snipe window: per-buy cap during the first `anti_snipe_slots` slots
//!   * `buy_exact_sol_in` for a plain "spend X SOL" UX (pump only exposes tokens-out)
//!   * graduation migrates into our AMM atomically and burns the LP
//!
//! Curve: constant product on *virtual* reserves (x * y = k) seeded with
//! `initial_virtual_sol_reserves` / `initial_virtual_token_reserves`; the curve completes
//! when `real_token_reserves` hits zero.
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::token::{self, Burn, CloseAccount, Mint, MintTo, SetAuthority, Token, TokenAccount, Transfer};
use anchor_spl::token::spl_token::instruction::AuthorityType;
use openpump_amm::program::OpenpumpAmm;

pub mod math;
use math::*;
pub mod quote;
use quote::*;

declare_id!("AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB");

pub const GLOBAL_SEED: &[u8] = b"global";
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint-authority";
pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const CREATOR_VAULT_SEED: &[u8] = b"creator-vault";

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u64 = 500; // 5% hard cap on protocol + creator
pub const TOKEN_DECIMALS: u8 = 6;
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// Only this key may run `initialize` (prevents a stranger from initialising the singleton).
pub const INITIAL_AUTHORITY: Pubkey = pubkey!("J37KbWUsm9NrVMQjS7b1UtrnxhrLjbot2m8R8REfz3jE");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct GlobalParams {
    pub fee_recipient: Pubkey,
    pub initial_virtual_token_reserves: u64,
    pub initial_virtual_sol_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub token_total_supply: u64,
    /// Protocol fee on every trade (bps of the SOL leg).
    pub fee_basis_points: u64,
    /// Creator fee on every trade (bps of the SOL leg), paid to the coin creator's vault.
    pub creator_fee_basis_points: u64,
    /// Flat SOL fee taken from the curve's reserves at migration.
    pub migration_fee_lamports: u64,
    /// Buys inside the first N slots after create are capped per transaction.
    pub anti_snipe_slots: u64,
    /// ...to this share of `token_total_supply` (bps).
    pub anti_snipe_max_bps: u64,
    pub paused: bool,
}

#[program]
pub mod openpump_curve {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: GlobalParams) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), INITIAL_AUTHORITY, CurveError::Unauthorized);
        validate_params(&params)?;
        let g = &mut ctx.accounts.global;
        g.authority = ctx.accounts.authority.key();
        g.amm_program = openpump_amm::ID;
        g.bump = ctx.bumps.global;
        g.apply(&params);
        emit_cpi!(SetParamsEvent { authority: g.authority, params, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    pub fn set_params(ctx: Context<AuthorityOnly>, params: GlobalParams) -> Result<()> {
        validate_params(&params)?;
        let g = &mut ctx.accounts.global;
        g.apply(&params);
        emit_cpi!(SetParamsEvent { authority: g.authority, params, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    pub fn update_authority(ctx: Context<AuthorityOnly>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.global.authority = new_authority;
        Ok(())
    }

    /// Launch a coin: new mint (6 decimals), Metaplex metadata, full supply into the curve,
    /// mint authority revoked. Anyone can call; `user` becomes the creator.
    pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String) -> Result<()> {
        let g = &ctx.accounts.global;
        require!(!g.paused, CurveError::Paused);
        require!(name.len() <= 32 && symbol.len() <= 10 && uri.len() <= 200, CurveError::MetadataTooLong);

        let mint_auth_seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]];
        let signer: &[&[&[u8]]] = &[mint_auth_seeds];

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.mpl_token_metadata.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.mint_authority.to_account_info(),
                    payer: ctx.accounts.user.to_account_info(),
                    update_authority: ctx.accounts.mint_authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer,
            ),
            DataV2 { name: name.clone(), symbol: symbol.clone(), uri: uri.clone(), seller_fee_basis_points: 0, creators: None, collection: None, uses: None },
            false, // is_mutable
            true,  // update_authority_is_signer
            None,
        )?;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.associated_bonding_curve.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer,
            ),
            g.token_total_supply,
        )?;
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority { current_authority: ctx.accounts.mint_authority.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info() },
                signer,
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        let clock = Clock::get()?;
        let bc = &mut ctx.accounts.bonding_curve;
        bc.mint = ctx.accounts.mint.key();
        bc.creator = ctx.accounts.user.key();
        bc.virtual_token_reserves = g.initial_virtual_token_reserves;
        bc.virtual_sol_reserves = g.initial_virtual_sol_reserves;
        bc.real_token_reserves = g.initial_real_token_reserves;
        bc.real_sol_reserves = 0;
        bc.token_total_supply = g.token_total_supply;
        bc.complete = false;
        bc.migrated = false;
        bc.created_slot = clock.slot;
        bc.creator_fees_total = 0;
        bc.protocol_fees_total = 0;
        bc.bump = ctx.bumps.bonding_curve;

        emit_cpi!(CreateEvent {
            name,
            symbol,
            uri,
            mint: bc.mint,
            bonding_curve: bc.key(),
            user: bc.creator,
            creator: bc.creator,
            virtual_token_reserves: bc.virtual_token_reserves,
            virtual_sol_reserves: bc.virtual_sol_reserves,
            real_token_reserves: bc.real_token_reserves,
            token_total_supply: bc.token_total_supply,
            timestamp: clock.unix_timestamp,
            quote_mint: bc.quote_mint,
        });
        Ok(())
    }

    /// Buy exactly `amount` tokens (partial-filled down to what is left on the curve),
    /// paying at most `max_sol_cost` lamports including fees.
    pub fn buy(ctx: Context<Trade>, amount: u64, max_sol_cost: u64) -> Result<()> {
        require!(amount > 0, CurveError::ZeroAmount);
        let bc = &ctx.accounts.bonding_curve;
        let tokens_out = amount.min(bc.real_token_reserves);
        let sol_in = sol_in_for_tokens_out(tokens_out, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
        execute_buy(ctx, tokens_out, sol_in, max_sol_cost)
    }

    /// Spend exactly `sol_in` lamports (before fees) for at least `min_tokens_out` tokens.
    /// If that would overshoot the curve, it partial-fills the remainder and charges only for it.
    pub fn buy_exact_sol_in(ctx: Context<Trade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_in > 0, CurveError::ZeroAmount);
        let bc = &ctx.accounts.bonding_curve;
        let g = &ctx.accounts.global;
        let mut tokens_out = tokens_out_for_sol_in(sol_in, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
        let mut spend = sol_in;
        if tokens_out >= bc.real_token_reserves {
            tokens_out = bc.real_token_reserves;
            spend = sol_in_for_tokens_out(tokens_out, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
        }
        require!(tokens_out >= min_tokens_out, CurveError::ExceededSlippage);
        let fees = total_fee(spend, g)?;
        execute_buy(ctx, tokens_out, spend, spend.checked_add(fees).ok_or(CurveError::MathOverflow)?)
    }

    /// Sell exactly `amount` tokens for at least `min_sol_output` lamports after fees.
    pub fn sell(ctx: Context<Trade>, amount: u64, min_sol_output: u64) -> Result<()> {
        require!(amount > 0, CurveError::ZeroAmount);
        let g = &ctx.accounts.global;
        require!(!g.paused, CurveError::Paused);
        let bc = &ctx.accounts.bonding_curve;
        require!(!bc.complete, CurveError::CurveComplete);

        let sol_out = sol_out_for_tokens_in(amount, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
        require!(sol_out <= bc.real_sol_reserves, CurveError::InsufficientReserves);
        let protocol_fee = fee_ceil(sol_out, g.fee_basis_points)?;
        let creator_fee = fee_ceil(sol_out, g.creator_fee_basis_points)?;
        let user_out = sol_out
            .checked_sub(protocol_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(CurveError::MathOverflow)?;
        require!(user_out >= min_sol_output, CurveError::ExceededSlippage);

        // tokens: user -> curve
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.associated_user.to_account_info(),
                    to: ctx.accounts.associated_bonding_curve.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // lamports: curve -> user / fee recipient / creator vault (curve is program-owned, debit directly)
        let bc_info = ctx.accounts.bonding_curve.to_account_info();
        debit(&bc_info, &ctx.accounts.user.to_account_info(), user_out)?;
        debit(&bc_info, &ctx.accounts.fee_recipient.to_account_info(), protocol_fee)?;
        debit(&bc_info, &ctx.accounts.creator_vault.to_account_info(), creator_fee)?;

        let bc = &mut ctx.accounts.bonding_curve;
        bc.virtual_token_reserves = bc.virtual_token_reserves.checked_add(amount).ok_or(CurveError::MathOverflow)?;
        bc.real_token_reserves = bc.real_token_reserves.checked_add(amount).ok_or(CurveError::MathOverflow)?;
        bc.virtual_sol_reserves = bc.virtual_sol_reserves.checked_sub(sol_out).ok_or(CurveError::MathOverflow)?;
        bc.real_sol_reserves = bc.real_sol_reserves.checked_sub(sol_out).ok_or(CurveError::MathOverflow)?;
        bc.protocol_fees_total = bc.protocol_fees_total.saturating_add(protocol_fee);
        bc.creator_fees_total = bc.creator_fees_total.saturating_add(creator_fee);

        emit_cpi!(TradeEvent {
            mint: bc.mint,
            sol_amount: sol_out,
            token_amount: amount,
            is_buy: false,
            user: ctx.accounts.user.key(),
            timestamp: Clock::get()?.unix_timestamp,
            virtual_sol_reserves: bc.virtual_sol_reserves,
            virtual_token_reserves: bc.virtual_token_reserves,
            real_sol_reserves: bc.real_sol_reserves,
            real_token_reserves: bc.real_token_reserves,
            protocol_fee,
            creator_fee,
            creator: bc.creator,
            quote_mint: bc.quote_mint,
        });
        Ok(())
    }

    /// Permissionless: once the curve is complete, move its SOL + remaining tokens into a
    /// fresh AMM pool and burn the LP. Price is continuous by construction when
    /// migration_fee_lamports == 0 (defaults mirror pump.fun's numbers).
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        let g = &ctx.accounts.global;
        let bc = &ctx.accounts.bonding_curve;
        require!(bc.complete, CurveError::CurveNotComplete);
        require!(!bc.migrated, CurveError::AlreadyMigrated);

        let base_amount = ctx.accounts.associated_bonding_curve.amount;
        require!(base_amount > 0, CurveError::InsufficientReserves);
        let quote_amount = bc.real_sol_reserves.checked_sub(g.migration_fee_lamports).ok_or(CurveError::InsufficientReserves)?;
        require!(quote_amount > 0, CurveError::InsufficientReserves);

        let mint_key = bc.mint;
        let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bc.bump]];
        let bc_signer: &[&[&[u8]]] = &[bc_seeds];
        let bc_info = ctx.accounts.bonding_curve.to_account_info();

        // 1. wrap the curve's SOL: create curve-owned WSOL ATA, move lamports in, sync
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: ctx.accounts.user.to_account_info(),
                associated_token: ctx.accounts.bonding_curve_wsol.to_account_info(),
                authority: bc_info.clone(),
                mint: ctx.accounts.wsol_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        // 2. migration fee -> protocol, curve SOL -> WSOL ATA. These are direct lamport moves on
        // program-owned/arbitrary accounts; the runtime only syncs accounts that take part in the
        // next CPI, so we pass both debited/credited accounts along with sync_native or the
        // instruction trips `UnbalancedInstruction`.
        debit(&bc_info, &ctx.accounts.fee_recipient.to_account_info(), g.migration_fee_lamports)?;
        debit(&bc_info, &ctx.accounts.bonding_curve_wsol.to_account_info(), quote_amount)?;
        {
            // Extra metas (ignored by the Token program) make the runtime sync both sides of the
            // direct lamport moves above before it checks the caller's balance invariant.
            let mut ix = anchor_spl::token::spl_token::instruction::sync_native(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.bonding_curve_wsol.key(),
            )?;
            ix.accounts.push(AccountMeta::new(bc_info.key(), false));
            ix.accounts.push(AccountMeta::new(ctx.accounts.fee_recipient.key(), false));
            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.bonding_curve_wsol.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    bc_info.clone(),
                    ctx.accounts.fee_recipient.to_account_info(),
                ],
            )?;
        }

        // 3. create the AMM pool, curve PDA = liquidity owner, user pays rent
        openpump_amm::cpi::create_pool(
            CpiContext::new_with_signer(
                ctx.accounts.amm_program.to_account_info(),
                openpump_amm::cpi::accounts::CreatePool {
                    pool: ctx.accounts.pool.to_account_info(),
                    global_config: ctx.accounts.amm_global_config.to_account_info(),
                    creator: bc_info.clone(),
                    payer: ctx.accounts.user.to_account_info(),
                    base_mint: ctx.accounts.mint.to_account_info(),
                    quote_mint: ctx.accounts.wsol_mint.to_account_info(),
                    lp_mint: ctx.accounts.lp_mint.to_account_info(),
                    user_base_token_account: ctx.accounts.associated_bonding_curve.to_account_info(),
                    user_quote_token_account: ctx.accounts.bonding_curve_wsol.to_account_info(),
                    user_pool_token_account: ctx.accounts.bonding_curve_lp.to_account_info(),
                    locked_lp_token_account: ctx.accounts.locked_lp_token_account.to_account_info(),
                    pool_base_token_account: ctx.accounts.pool_base_token_account.to_account_info(),
                    pool_quote_token_account: ctx.accounts.pool_quote_token_account.to_account_info(),
                    coin_creator_vault_authority: ctx.accounts.coin_creator_vault_authority.to_account_info(),
                    coin_creator_vault_ata: ctx.accounts.coin_creator_vault_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    base_token_program: ctx.accounts.token_program.to_account_info(),
                    quote_token_program: ctx.accounts.token_program.to_account_info(),
                    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    event_authority: ctx.accounts.amm_event_authority.to_account_info(),
                    program: ctx.accounts.amm_program.to_account_info(),
                },
                bc_signer,
            ),
            0,
            base_amount,
            quote_amount,
            bc.creator,
        )?;

        // 4. burn every LP token the curve received, then close the empty helper accounts
        let lp_amount = {
            let data = ctx.accounts.bonding_curve_lp.try_borrow_data()?;
            TokenAccount::try_deserialize(&mut &data[..])?.amount
        };
        if lp_amount > 0 {
            token::burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.lp_mint.to_account_info(),
                        from: ctx.accounts.bonding_curve_lp.to_account_info(),
                        authority: bc_info.clone(),
                    },
                    bc_signer,
                ),
                lp_amount,
            )?;
        }
        for acct in [&ctx.accounts.bonding_curve_lp, &ctx.accounts.bonding_curve_wsol] {
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: acct.to_account_info(),
                    destination: ctx.accounts.user.to_account_info(),
                    authority: bc_info.clone(),
                },
                bc_signer,
            ))?;
        }

        let bc = &mut ctx.accounts.bonding_curve;
        bc.migrated = true;
        bc.real_sol_reserves = 0;

        emit_cpi!(MigrateEvent {
            mint: bc.mint,
            bonding_curve: bc.key(),
            pool: ctx.accounts.pool.key(),
            user: ctx.accounts.user.key(),
            base_amount,
            quote_amount,
            migration_fee: g.migration_fee_lamports,
            lp_burned: lp_amount,
            timestamp: Clock::get()?.unix_timestamp,
            quote_mint: bc.quote_mint,
        });
        Ok(())
    }

    // ----- custom pairs (v2 family, see quote.rs)

    pub fn set_quote_config(ctx: Context<SetQuoteConfig>, params: QuoteParams) -> Result<()> {
        quote::set_quote_config(ctx, params)
    }
    pub fn create_v2(ctx: Context<CreateV2>, name: String, symbol: String, uri: String) -> Result<()> {
        quote::create_v2(ctx, name, symbol, uri)
    }
    pub fn buy_v2(ctx: Context<TradeV2>, amount: u64, max_quote_cost: u64) -> Result<()> {
        quote::buy_v2(ctx, amount, max_quote_cost)
    }
    pub fn buy_exact_quote_in(ctx: Context<TradeV2>, quote_in: u64, min_tokens_out: u64) -> Result<()> {
        quote::buy_exact_quote_in(ctx, quote_in, min_tokens_out)
    }
    pub fn sell_v2(ctx: Context<TradeV2>, amount: u64, min_quote_output: u64) -> Result<()> {
        quote::sell_v2(ctx, amount, min_quote_output)
    }
    pub fn collect_creator_fee_v2(ctx: Context<CollectCreatorFeeV2>) -> Result<()> {
        quote::collect_creator_fee_v2(ctx)
    }
    pub fn migrate_v2(ctx: Context<MigrateV2>) -> Result<()> {
        quote::migrate_v2(ctx)
    }

    /// The creator sweeps their vault (all SOL above rent-exemption) to their wallet.
    pub fn collect_creator_fee(ctx: Context<CollectCreatorFee>) -> Result<()> {
        let vault = &ctx.accounts.creator_vault;
        let min = Rent::get()?.minimum_balance(0);
        let amount = vault.lamports().saturating_sub(min);
        require!(amount > 0, CurveError::ZeroAmount);
        let creator_key = ctx.accounts.creator.key();
        let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, creator_key.as_ref(), &[ctx.bumps.creator_vault]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer { from: vault.to_account_info(), to: ctx.accounts.creator.to_account_info() },
                &[seeds],
            ),
            amount,
        )?;
        emit_cpi!(CollectCreatorFeeEvent { creator: creator_key, amount, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }
}

// ---------------------------------------------------------------- shared buy path

fn execute_buy(ctx: Context<Trade>, tokens_out: u64, sol_in: u64, max_sol_cost: u64) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, CurveError::Paused);
    let bc = &ctx.accounts.bonding_curve;
    require!(!bc.complete, CurveError::CurveComplete);
    require!(tokens_out > 0 && sol_in > 0, CurveError::ZeroAmount);

    // anti-snipe: cap per-buy size during the opening window
    let clock = Clock::get()?;
    if g.anti_snipe_slots > 0 && clock.slot < bc.created_slot.saturating_add(g.anti_snipe_slots) {
        let cap = mul_div_floor(bc.token_total_supply, g.anti_snipe_max_bps, BPS_DENOMINATOR)?;
        require!(tokens_out <= cap, CurveError::AntiSnipeCap);
    }

    let protocol_fee = fee_ceil(sol_in, g.fee_basis_points)?;
    let creator_fee = fee_ceil(sol_in, g.creator_fee_basis_points)?;
    let total_cost = sol_in
        .checked_add(protocol_fee)
        .and_then(|v| v.checked_add(creator_fee))
        .ok_or(CurveError::MathOverflow)?;
    require!(total_cost <= max_sol_cost, CurveError::ExceededSlippage);

    // lamports: user -> curve / fee recipient / creator vault
    let user = ctx.accounts.user.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    sys_transfer(&sys, &user, &ctx.accounts.bonding_curve.to_account_info(), sol_in)?;
    sys_transfer(&sys, &user, &ctx.accounts.fee_recipient.to_account_info(), protocol_fee)?;
    sys_transfer(&sys, &user, &ctx.accounts.creator_vault.to_account_info(), creator_fee)?;

    // tokens: curve -> user
    let mint_key = bc.mint;
    let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bc.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.associated_bonding_curve.to_account_info(),
                to: ctx.accounts.associated_user.to_account_info(),
                authority: ctx.accounts.bonding_curve.to_account_info(),
            },
            &[bc_seeds],
        ),
        tokens_out,
    )?;

    let bc = &mut ctx.accounts.bonding_curve;
    bc.virtual_token_reserves = bc.virtual_token_reserves.checked_sub(tokens_out).ok_or(CurveError::MathOverflow)?;
    bc.real_token_reserves = bc.real_token_reserves.checked_sub(tokens_out).ok_or(CurveError::MathOverflow)?;
    bc.virtual_sol_reserves = bc.virtual_sol_reserves.checked_add(sol_in).ok_or(CurveError::MathOverflow)?;
    bc.real_sol_reserves = bc.real_sol_reserves.checked_add(sol_in).ok_or(CurveError::MathOverflow)?;
    bc.protocol_fees_total = bc.protocol_fees_total.saturating_add(protocol_fee);
    bc.creator_fees_total = bc.creator_fees_total.saturating_add(creator_fee);
    if bc.real_token_reserves == 0 {
        bc.complete = true;
    }

    emit_cpi!(TradeEvent {
        mint: bc.mint,
        sol_amount: sol_in,
        token_amount: tokens_out,
        is_buy: true,
        user: ctx.accounts.user.key(),
        timestamp: clock.unix_timestamp,
        virtual_sol_reserves: bc.virtual_sol_reserves,
        virtual_token_reserves: bc.virtual_token_reserves,
        real_sol_reserves: bc.real_sol_reserves,
        real_token_reserves: bc.real_token_reserves,
        protocol_fee,
        creator_fee,
        creator: bc.creator,
        quote_mint: bc.quote_mint,
    });
    if bc.complete {
        emit_cpi!(CompleteEvent {
            mint: bc.mint,
            bonding_curve: bc.key(),
            user: ctx.accounts.user.key(),
            real_sol_reserves: bc.real_sol_reserves,
            timestamp: clock.unix_timestamp,
        });
    }
    Ok(())
}

fn total_fee(sol: u64, g: &Global) -> Result<u64> {
    fee_ceil(sol, g.fee_basis_points)?
        .checked_add(fee_ceil(sol, g.creator_fee_basis_points)?)
        .ok_or(CurveError::MathOverflow.into())
}

fn validate_params(p: &GlobalParams) -> Result<()> {
    let total = p.fee_basis_points.checked_add(p.creator_fee_basis_points).ok_or(CurveError::MathOverflow)?;
    require!(total <= MAX_FEE_BPS, CurveError::FeeTooHigh);
    require!(p.initial_virtual_token_reserves > 0 && p.initial_virtual_sol_reserves > 0, CurveError::InvalidParams);
    require!(p.initial_real_token_reserves > 0 && p.initial_real_token_reserves < p.token_total_supply, CurveError::InvalidParams);
    require!(p.initial_real_token_reserves < p.initial_virtual_token_reserves, CurveError::InvalidParams);
    require!(p.anti_snipe_max_bps <= BPS_DENOMINATOR, CurveError::InvalidParams);
    require!(p.fee_recipient != Pubkey::default(), CurveError::InvalidParams);
    Ok(())
}

fn sys_transfer<'info>(sys: &AccountInfo<'info>, from: &AccountInfo<'info>, to: &AccountInfo<'info>, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(sys.clone(), system_program::Transfer { from: from.clone(), to: to.clone() }),
        lamports,
    )
}

/// Move lamports out of a program-owned account (the curve) into any account.
fn debit(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    **from.try_borrow_mut_lamports()? = from.lamports().checked_sub(lamports).ok_or(CurveError::InsufficientReserves)?;
    **to.try_borrow_mut_lamports()? = to.lamports().checked_add(lamports).ok_or(CurveError::MathOverflow)?;
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Global::INIT_SPACE, seeds = [GLOBAL_SEED], bump)]
    pub global: Account<'info, Global>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_SEED], bump = global.bump, has_one = authority @ CurveError::Unauthorized)]
    pub global: Account<'info, Global>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Create<'info> {
    #[account(init, payer = user, mint::decimals = TOKEN_DECIMALS, mint::authority = mint_authority)]
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA, only ever used as a signer.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(init, payer = user, space = 8 + BondingCurve::INIT_SPACE, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump)]
    pub bonding_curve: Account<'info, BondingCurve>,
    #[account(init, payer = user, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Account<'info, TokenAccount>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,
    pub mpl_token_metadata: Program<'info, Metadata>,
    /// CHECK: validated by the Metaplex program (PDA of ["metadata", program, mint]).
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(mut, address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, constraint = bonding_curve.quote_mint == Pubkey::default() @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user)]
    pub associated_user: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: system-owned PDA that accrues the creator's fees.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, bonding_curve.creator.as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Migrate<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(mut, address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, constraint = bonding_curve.quote_mint == Pubkey::default() @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Box<Account<'info, TokenAccount>>,
    /// CHECK: curve-owned WSOL ATA, created in this instruction and closed at the end.
    #[account(mut)]
    pub bonding_curve_wsol: UncheckedAccount<'info>,
    /// CHECK: curve-owned LP ATA, created by the AMM CPI and closed at the end.
    #[account(mut)]
    pub bonding_curve_lp: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(address = WSOL_MINT)]
    pub wsol_mint: Box<Account<'info, Mint>>,

    // --- AMM side (validated by the AMM program) ---
    #[account(address = global.amm_program)]
    pub amm_program: Program<'info, OpenpumpAmm>,
    /// CHECK: AMM global config PDA.
    pub amm_global_config: UncheckedAccount<'info>,
    /// CHECK: pool PDA, initialised by the AMM.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: LP mint PDA, initialised by the AMM.
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: pool-owned LP ATA holding the locked minimum, initialised by the AMM.
    #[account(mut)]
    pub locked_lp_token_account: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub pool_base_token_account: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub pool_quote_token_account: UncheckedAccount<'info>,
    /// CHECK: AMM PDA for the coin creator's vault.
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub coin_creator_vault_ata: UncheckedAccount<'info>,
    /// CHECK: AMM event authority PDA.
    pub amm_event_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CollectCreatorFee<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: system-owned PDA that accrues the creator's fees.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, creator.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Global {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub amm_program: Pubkey,
    pub initial_virtual_token_reserves: u64,
    pub initial_virtual_sol_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub token_total_supply: u64,
    pub fee_basis_points: u64,
    pub creator_fee_basis_points: u64,
    pub migration_fee_lamports: u64,
    pub anti_snipe_slots: u64,
    pub anti_snipe_max_bps: u64,
    pub paused: bool,
    pub bump: u8,
}

impl Global {
    fn apply(&mut self, p: &GlobalParams) {
        self.fee_recipient = p.fee_recipient;
        self.initial_virtual_token_reserves = p.initial_virtual_token_reserves;
        self.initial_virtual_sol_reserves = p.initial_virtual_sol_reserves;
        self.initial_real_token_reserves = p.initial_real_token_reserves;
        self.token_total_supply = p.token_total_supply;
        self.fee_basis_points = p.fee_basis_points;
        self.creator_fee_basis_points = p.creator_fee_basis_points;
        self.migration_fee_lamports = p.migration_fee_lamports;
        self.anti_snipe_slots = p.anti_snipe_slots;
        self.anti_snipe_max_bps = p.anti_snipe_max_bps;
        self.paused = p.paused;
    }
}

#[account]
#[derive(InitSpace)]
pub struct BondingCurve {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub migrated: bool,
    pub created_slot: u64,
    pub creator_fees_total: u64,
    pub protocol_fees_total: u64,
    pub bump: u8,
    /// Pubkey::default() = native SOL curve; otherwise the SPL/Token-2022 quote mint (v2 family).
    pub quote_mint: Pubkey,
}

// ---------------------------------------------------------------- events

#[event]
pub struct SetParamsEvent {
    pub authority: Pubkey,
    pub params: GlobalParams,
    pub timestamp: i64,
}

#[event]
pub struct CreateEvent {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub user: Pubkey,
    pub creator: Pubkey,
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub token_total_supply: u64,
    pub timestamp: i64,
    pub quote_mint: Pubkey,
}

#[event]
pub struct TradeEvent {
    pub mint: Pubkey,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub is_buy: bool,
    pub user: Pubkey,
    pub timestamp: i64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub protocol_fee: u64,
    pub creator_fee: u64,
    pub creator: Pubkey,
    pub quote_mint: Pubkey,
}

#[event]
pub struct CompleteEvent {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub user: Pubkey,
    pub real_sol_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct MigrateEvent {
    pub mint: Pubkey,
    pub bonding_curve: Pubkey,
    pub pool: Pubkey,
    pub user: Pubkey,
    pub base_amount: u64,
    pub quote_amount: u64,
    pub migration_fee: u64,
    pub lp_burned: u64,
    pub timestamp: i64,
    pub quote_mint: Pubkey,
}

#[event]
pub struct CollectCreatorFeeEvent {
    pub creator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum CurveError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Launchpad is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Name, symbol or uri too long")]
    MetadataTooLong,
    #[msg("Bonding curve is complete; trade on the AMM")]
    CurveComplete,
    #[msg("Bonding curve is not complete yet")]
    CurveNotComplete,
    #[msg("Already migrated")]
    AlreadyMigrated,
    #[msg("Slippage limit exceeded")]
    ExceededSlippage,
    #[msg("Insufficient reserves")]
    InsufficientReserves,
    #[msg("Buy exceeds the anti-snipe cap for this slot window")]
    AntiSnipeCap,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid protocol fee recipient")]
    InvalidFeeRecipient,
    #[msg("Quote mint is not enabled")]
    QuoteMintDisabled,
    #[msg("Wrong quote mint for this bonding curve")]
    WrongQuoteMint,
}
