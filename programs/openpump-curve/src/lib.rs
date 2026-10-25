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
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked};
use openpump_amm::program::OpenpumpAmm;

pub mod math;
use math::*;
pub mod quote;
use quote::*;
pub mod holders;
use holders::*;
pub mod incentives;
use incentives::*;
pub mod sharing;
use sharing::*;
pub mod admin;
use admin::*;
pub mod token2022;
use token2022::*;
use openpump_fee_types::{FeeConfig, FEES_PROGRAM_ID, FEE_CONFIG_SEED};

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
    /// Share of the protocol fee (bps) routed to `buyback_fee_recipient` (the fees program's buyback vault).
    pub buyback_basis_points: u64,
    pub buyback_fee_recipient: Pubkey,
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
        g.holder_reward_enabled = true;
        g.holder_reward_authority = ctx.accounts.authority.key();
        g.admin_set_creator_authority = ctx.accounts.authority.key();
        g.creator_fee_configurable = true;
        g.max_configurable_creator_fee_bps = 100; // creators may set up to 1 %
        g.mayhem_mode_enabled = false;
        g.mayhem_initial_virtual_sol_reserves = params.initial_virtual_sol_reserves;
        g.mayhem_initial_virtual_token_reserves = params.initial_virtual_token_reserves;
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
    /// `creator`: who earns the creator fee (Pubkey::default() = the launching wallet). May be a
    /// fees-program PDA (social / donation / sharing) so fees accrue there from trade one.
    pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String, is_holder_reward: bool, creator: Pubkey, is_mayhem_mode: bool) -> Result<()> {
        let g = &ctx.accounts.global;
        require!(!g.paused, CurveError::Paused);
        require!(!is_holder_reward || g.holder_reward_enabled, CurveError::HolderRewardDisabled);
        require!(!is_mayhem_mode || g.mayhem_mode_enabled, CurveError::MayhemDisabled);
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
        bc.creator = if is_holder_reward { holder_rewards_pda(&bc.mint) } else if creator == Pubkey::default() { ctx.accounts.user.key() } else { creator };
        bc.is_holder_reward = is_holder_reward;
        bc.creator_fee_bps = 0;
        bc.can_edit_creator_fee = !is_holder_reward;
        bc.is_mayhem_mode = is_mayhem_mode;
        bc.virtual_token_reserves = if is_mayhem_mode { g.mayhem_initial_virtual_token_reserves } else { g.initial_virtual_token_reserves };
        bc.virtual_sol_reserves = if is_mayhem_mode { g.mayhem_initial_virtual_sol_reserves } else { g.initial_virtual_sol_reserves };
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
            is_holder_reward: bc.is_holder_reward,
            token_program: ctx.accounts.token_program.key(),
            is_mayhem_mode: bc.is_mayhem_mode,
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
        let fees = total_fee(spend, g, &ctx.accounts.fee_config, bc)?;
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
        let (p_bps, c_bps) = trade_fee_bps(g, &ctx.accounts.fee_config, bc);
        let protocol_fee = fee_ceil(sol_out, p_bps)?;
        let creator_fee = fee_ceil(sol_out, c_bps)?;
        let buyback_fee = buyback_split(g, &ctx.accounts.buyback_fee_recipient, protocol_fee)?;
        let user_out = sol_out
            .checked_sub(protocol_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(CurveError::MathOverflow)?;
        require!(user_out >= min_sol_output, CurveError::ExceededSlippage);

        // tokens: user -> curve
        ti::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.associated_user.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.associated_bonding_curve.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            TOKEN_DECIMALS,
        )?;

        // lamports: curve -> user / fee recipient / creator vault (curve is program-owned, debit directly)
        let bc_info = ctx.accounts.bonding_curve.to_account_info();
        debit(&bc_info, &ctx.accounts.user.to_account_info(), user_out)?;
        debit(&bc_info, &ctx.accounts.fee_recipient.to_account_info(), protocol_fee - buyback_fee)?;
        if let Some(bb) = &ctx.accounts.buyback_fee_recipient {
            debit(&bc_info, &bb.to_account_info(), buyback_fee)?;
        }
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
            buyback_fee,
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
                    base_token_program: ctx.accounts.base_token_program.to_account_info(),
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
            bc.is_mayhem_mode,
            bc.is_holder_reward,
            bc.creator_fee_bps,
            bc.can_edit_creator_fee,
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

    // ----- holder rewards (see holders.rs)

    pub fn update_holder_reward_config(ctx: Context<AuthorityOnly>, enabled: bool, authority: Pubkey) -> Result<()> {
        holders::update_holder_reward_config(ctx, enabled, authority)
    }
    pub fn distribute_fee_to_holders<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeFeeToHolders<'info>>, amounts: Vec<u64>) -> Result<()> {
        holders::distribute_fee_to_holders(ctx, amounts)
    }
    pub fn distribute_fee_to_holders_v2<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeFeeToHoldersV2<'info>>, amounts: Vec<u64>) -> Result<()> {
        holders::distribute_fee_to_holders_v2(ctx, amounts)
    }

    // ----- community takeover + creator fee configuration (see admin.rs)

    pub fn admin_cto(ctx: Context<AdminCto>, is_holder_reward: bool, creator_fee_bps: Option<u64>, new_creator: Option<Pubkey>) -> Result<()> {
        admin::admin_cto(ctx, is_holder_reward, creator_fee_bps, new_creator)
    }
    pub fn update_creator_fee_config(ctx: Context<AuthorityOnly>, creator_fee_configurable: bool, max_configurable_creator_fee_bps: u64) -> Result<()> {
        admin::update_creator_fee_config(ctx, creator_fee_configurable, max_configurable_creator_fee_bps)
    }
    pub fn set_admin_set_creator_authority(ctx: Context<AuthorityOnly>, authority: Pubkey) -> Result<()> {
        admin::set_admin_set_creator_authority(ctx, authority)
    }
    /// AMM buys count toward the shared volume-incentive campaign: the AMM program's volume-tracker PDA
    /// signs this CPI with the SOL amount of the swap.
    pub fn track_amm_volume(ctx: Context<TrackAmmVolume>, sol_amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        incentives::track(&mut ctx.accounts.global_volume_accumulator, &mut ctx.accounts.user_volume_accumulator, now, sol_amount)
    }

    /// Grow a Global / BondingCurve account created by an older program version to the current layout
    /// (new fields read as zero / false). Permissionless; the payer covers the rent delta.
    pub fn extend_account(ctx: Context<ExtendAccount>) -> Result<()> {
        let info = ctx.accounts.account.to_account_info();
        let target = {
            let data = info.try_borrow_data()?;
            require!(data.len() >= 8, CurveError::InvalidParams);
            if data[..8] == *Global::DISCRIMINATOR { 8 + Global::INIT_SPACE } else if data[..8] == *BondingCurve::DISCRIMINATOR { 8 + BondingCurve::INIT_SPACE } else { return Err(CurveError::InvalidParams.into()) }
        };
        require!(info.data_len() < target, CurveError::InvalidParams);
        let delta = Rent::get()?.minimum_balance(target).saturating_sub(info.lamports());
        if delta > 0 {
            system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: info.clone() }), delta)?;
        }
        info.resize(target)?;
        Ok(())
    }

    pub fn toggle_mayhem_mode(ctx: Context<AuthorityOnly>, enabled: bool) -> Result<()> {
        ctx.accounts.global.mayhem_mode_enabled = enabled;
        Ok(())
    }
    pub fn set_mayhem_virtual_params(ctx: Context<AuthorityOnly>, initial_virtual_sol_reserves: u64, initial_virtual_token_reserves: u64) -> Result<()> {
        require!(initial_virtual_sol_reserves > 0 && initial_virtual_token_reserves > ctx.accounts.global.initial_real_token_reserves, CurveError::InvalidParams);
        let g = &mut ctx.accounts.global;
        g.mayhem_initial_virtual_sol_reserves = initial_virtual_sol_reserves;
        g.mayhem_initial_virtual_token_reserves = initial_virtual_token_reserves;
        Ok(())
    }
    pub fn set_creator_fee_bps(ctx: Context<CreatorOnly>, creator_fee_bps: u64, lock: bool) -> Result<()> {
        admin::set_creator_fee_bps(ctx, creator_fee_bps, lock)
    }

    // ----- creator reassignment + fee sharing payouts (see sharing.rs)

    pub fn set_creator(ctx: Context<SetCreator>, new_creator: Pubkey) -> Result<()> {
        sharing::set_creator(ctx, new_creator)
    }
    pub fn distribute_creator_fees<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeCreatorFees<'info>>) -> Result<()> {
        sharing::distribute_creator_fees(ctx)
    }
    pub fn distribute_creator_fees_v2<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeCreatorFeesV2<'info>>, initialize_ata: bool) -> Result<()> {
        sharing::distribute_creator_fees_v2(ctx, initialize_ata)
    }

    // ----- volume incentives (see incentives.rs)

    pub fn init_user_volume_accumulator(ctx: Context<InitUserVolumeAccumulator>) -> Result<()> {
        incentives::init_user_volume_accumulator(ctx)
    }
    pub fn close_user_volume_accumulator(ctx: Context<CloseUserVolumeAccumulator>) -> Result<()> {
        incentives::close_user_volume_accumulator(ctx)
    }
    pub fn sync_user_volume_accumulator(ctx: Context<SyncUserVolumeAccumulator>) -> Result<()> {
        incentives::sync_user_volume_accumulator(ctx)
    }
    pub fn admin_update_token_incentives(ctx: Context<AdminUpdateTokenIncentives>, start_time: i64, end_time: i64, seconds_in_a_day: i64, day_number: u64, token_supply_per_day: u64) -> Result<()> {
        incentives::admin_update_token_incentives(ctx, start_time, end_time, seconds_in_a_day, day_number, token_supply_per_day)
    }
    pub fn claim_token_incentives(ctx: Context<ClaimTokenIncentives>) -> Result<()> {
        incentives::claim_token_incentives(ctx)
    }

    // ----- Token-2022 coins (see token2022.rs)

    pub fn create_v3(ctx: Context<CreateV3>, name: String, symbol: String, uri: String, is_holder_reward: bool, creator: Pubkey, is_mayhem_mode: bool) -> Result<()> {
        token2022::create_v3(ctx, name, symbol, uri, is_holder_reward, creator, is_mayhem_mode)
    }

    // ----- custom pairs (v2 family, see quote.rs)

    pub fn set_quote_config(ctx: Context<SetQuoteConfig>, params: QuoteParams) -> Result<()> {
        quote::set_quote_config(ctx, params)
    }
    pub fn create_v2(ctx: Context<CreateV2>, name: String, symbol: String, uri: String, is_holder_reward: bool, creator: Pubkey) -> Result<()> {
        quote::create_v2(ctx, name, symbol, uri, is_holder_reward, creator) // custom pairs are never mayhem
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

    let (p_bps, c_bps) = trade_fee_bps(g, &ctx.accounts.fee_config, bc);
    let protocol_fee = fee_ceil(sol_in, p_bps)?;
    let creator_fee = fee_ceil(sol_in, c_bps)?;
    let total_cost = sol_in
        .checked_add(protocol_fee)
        .and_then(|v| v.checked_add(creator_fee))
        .ok_or(CurveError::MathOverflow)?;
    require!(total_cost <= max_sol_cost, CurveError::ExceededSlippage);
    let buyback_fee = buyback_split(g, &ctx.accounts.buyback_fee_recipient, protocol_fee)?;

    // lamports: user -> curve / fee recipient (+ buyback vault) / creator vault
    let user = ctx.accounts.user.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    sys_transfer(&sys, &user, &ctx.accounts.bonding_curve.to_account_info(), sol_in)?;
    sys_transfer(&sys, &user, &ctx.accounts.fee_recipient.to_account_info(), protocol_fee - buyback_fee)?;
    if let Some(bb) = &ctx.accounts.buyback_fee_recipient {
        sys_transfer(&sys, &user, &bb.to_account_info(), buyback_fee)?;
    }
    sys_transfer(&sys, &user, &ctx.accounts.creator_vault.to_account_info(), creator_fee)?;

    // tokens: curve -> user
    let mint_key = bc.mint;
    let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bc.bump]];
    ti::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.associated_bonding_curve.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.associated_user.to_account_info(),
                authority: ctx.accounts.bonding_curve.to_account_info(),
            },
            &[bc_seeds],
        ),
        tokens_out,
        TOKEN_DECIMALS,
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

    // volume incentives (opt-in by passing both accumulator accounts)
    if let (Some(g_acc), Some(u_acc)) = (ctx.accounts.global_volume_accumulator.as_mut(), ctx.accounts.user_volume_accumulator.as_mut()) {
        incentives::track(g_acc, u_acc, clock.unix_timestamp, sol_in)?;
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
        buyback_fee,
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

/// (protocol_bps, creator_bps) for a trade: the fees program's market-cap tiers when a FeeConfig
/// is passed, otherwise Global's flat schedule.
pub fn trade_fee_bps(g: &Global, fee_config: &Option<Box<Account<FeeConfig>>>, bc: &BondingCurve) -> (u64, u64) {
    let (p, c) = if let Some(fc) = fee_config {
        let mcap = openpump_fee_types::market_cap(bc.virtual_sol_reserves, bc.virtual_token_reserves, bc.token_total_supply);
        let f = openpump_fee_types::fees_for(fc, true, mcap, bc.quote_mint);
        (f.protocol_fee_bps, f.creator_fee_bps)
    } else {
        (g.fee_basis_points, g.creator_fee_basis_points)
    };
    // creator-configured override (within the admin ceiling, enforced when set)
    (p, if bc.creator_fee_bps > 0 { bc.creator_fee_bps } else { c })
}

fn total_fee(sol: u64, g: &Global, fee_config: &Option<Box<Account<FeeConfig>>>, bc: &BondingCurve) -> Result<u64> {
    let (p, c) = trade_fee_bps(g, fee_config, bc);
    fee_ceil(sol, p)?.checked_add(fee_ceil(sol, c)?).ok_or(CurveError::MathOverflow.into())
}

fn validate_params(p: &GlobalParams) -> Result<()> {
    let total = p.fee_basis_points.checked_add(p.creator_fee_basis_points).ok_or(CurveError::MathOverflow)?;
    require!(total <= MAX_FEE_BPS, CurveError::FeeTooHigh);
    require!(p.initial_virtual_token_reserves > 0 && p.initial_virtual_sol_reserves > 0, CurveError::InvalidParams);
    require!(p.initial_real_token_reserves > 0 && p.initial_real_token_reserves < p.token_total_supply, CurveError::InvalidParams);
    require!(p.initial_real_token_reserves < p.initial_virtual_token_reserves, CurveError::InvalidParams);
    require!(p.anti_snipe_max_bps <= BPS_DENOMINATOR, CurveError::InvalidParams);
    require!(p.buyback_basis_points <= BPS_DENOMINATOR, CurveError::InvalidParams);
    require!(p.fee_recipient != Pubkey::default(), CurveError::InvalidParams);
    Ok(())
}

fn buyback_split(g: &Global, recipient: &Option<UncheckedAccount>, protocol_fee: u64) -> Result<u64> {
    match recipient {
        Some(_) if g.buyback_basis_points > 0 => mul_div_floor(protocol_fee, g.buyback_basis_points, BPS_DENOMINATOR),
        _ => Ok(0),
    }
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

#[derive(Accounts)]
pub struct TrackAmmVolume<'info> {
    /// CHECK: the trader; only used as the user accumulator's seed.
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [GLOBAL_VOLUME_SEED], bump = global_volume_accumulator.bump)]
    pub global_volume_accumulator: Box<Account<'info, GlobalVolumeAccumulator>>,
    #[account(mut, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump = user_volume_accumulator.bump)]
    pub user_volume_accumulator: Box<Account<'info, UserVolumeAccumulator>>,
    /// Only the AMM program, through its volume-tracker PDA, may record AMM volume.
    #[account(seeds = [b"volume-tracker"], bump, seeds::program = openpump_amm::ID)]
    pub volume_tracker: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExtendAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: a Global or BondingCurve owned by this program; discriminator checked in the handler.
    #[account(mut, owner = crate::ID @ CurveError::InvalidParams)]
    pub account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(mut, address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, constraint = bonding_curve.quote_mint == Pubkey::default() @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve, associated_token::token_program = token_program)]
    pub associated_bonding_curve: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub associated_user: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: system-owned PDA that accrues the creator's fees.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, bonding_curve.creator.as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// Token program of the coin (SPL Token or Token-2022).
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// Optional: pass both accumulators to have this buy count toward volume incentives.
    #[account(mut, seeds = [GLOBAL_VOLUME_SEED], bump = global_volume_accumulator.bump)]
    pub global_volume_accumulator: Option<Box<Account<'info, GlobalVolumeAccumulator>>>,
    #[account(mut, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump = user_volume_accumulator.bump)]
    pub user_volume_accumulator: Option<Box<Account<'info, UserVolumeAccumulator>>>,
    /// Optional: the fees program's tiered schedule (market-cap based). Flat Global fees otherwise.
    #[account(seeds = [FEE_CONFIG_SEED], bump = fee_config.bump, seeds::program = FEES_PROGRAM_ID)]
    pub fee_config: Option<Box<Account<'info, FeeConfig>>>,
    /// CHECK: optional buyback vault; must match Global.buyback_fee_recipient.
    #[account(mut, address = global.buyback_fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub buyback_fee_recipient: Option<UncheckedAccount<'info>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Migrate<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(mut, address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, constraint = bonding_curve.quote_mint == Pubkey::default() @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve, associated_token::token_program = base_token_program)]
    pub associated_bonding_curve: Box<InterfaceAccount<'info, TokenAccountI>>,
    /// Token program of the coin (SPL Token or Token-2022).
    pub base_token_program: Interface<'info, TokenInterface>,
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
    /// CHECK: receives its own vault; permissionless so PDA creators (social / donation) get swept.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
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
    /// Holder rewards: coins may route the creator fee to holders (distributed by this authority).
    pub holder_reward_enabled: bool,
    pub holder_reward_authority: Pubkey,
    pub buyback_basis_points: u64,
    pub buyback_fee_recipient: Pubkey,
    /// Community takeover authority (defaults to `authority`).
    pub admin_set_creator_authority: Pubkey,
    pub creator_fee_configurable: bool,
    pub max_configurable_creator_fee_bps: u64,
    /// Mayhem mode: coins launched with it start from these virtual reserves and are traded by the mayhem vault.
    pub mayhem_mode_enabled: bool,
    pub mayhem_initial_virtual_sol_reserves: u64,
    pub mayhem_initial_virtual_token_reserves: u64,
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
        self.buyback_basis_points = p.buyback_basis_points;
        self.buyback_fee_recipient = p.buyback_fee_recipient;
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
    /// If set, `creator` is the ["holder-rewards", mint] PDA and the creator fee is paid out to holders.
    pub is_holder_reward: bool,
    /// Per-coin creator fee override (bps). 0 = follow the fee schedule.
    pub creator_fee_bps: u64,
    pub can_edit_creator_fee: bool,
    /// Launched in mayhem mode: the mayhem vault trades it until its deadline, then burns.
    pub is_mayhem_mode: bool,
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
    pub is_holder_reward: bool,
    pub token_program: Pubkey,
    pub is_mayhem_mode: bool,
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
    pub buyback_fee: u64,
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
    #[msg("Holder-reward coins are disabled")]
    HolderRewardDisabled,
    #[msg("This coin does not route rewards to holders")]
    NotHolderRewardCoin,
    #[msg("Amounts and recipient accounts do not match")]
    HolderRecipientsMismatch,
    #[msg("Invalid incentive schedule time or day")]
    IncentiveTime,
    #[msg("Sharing config is not active")]
    SharingNotActive,
    #[msg("Sharing config does not match this coin")]
    SharingMismatch,
    #[msg("The creator of a holder-reward coin cannot be changed")]
    HolderRewardCreatorImmutable,
    #[msg("Creator fee is not configurable")]
    CreatorFeeNotConfigurable,
    #[msg("Creator fee is locked for this coin")]
    CreatorFeeLocked,
    #[msg("Mayhem mode is disabled")]
    MayhemDisabled,
}
