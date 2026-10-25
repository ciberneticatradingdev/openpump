//! OpenPump AMM — a constant-product AMM where graduated coins trade.
//!
//! Clean-room implementation. The instruction *shape* mirrors PumpSwap's public
//! IDL (create_config / create_pool / deposit / withdraw / buy / sell /
//! collect_coin_creator_fee) so existing tooling can integrate by swapping the
//! program id, but seeds, authorities, fee schedule and code are our own.
//!
//! Fee model (all in basis points of the quote leg):
//!   * lp_fee            stays in the pool (accrues to LP holders)
//!   * protocol_fee      -> protocol fee recipient's quote ATA
//!   * coin_creator_fee  -> per-creator vault (quote ATA owned by a PDA), claimable any time
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

pub mod math;
use math::*;
pub mod multihop;
use multihop::*;
pub mod boost;
use boost::*;
use openpump_fee_types::{ConfigStatus, FeeConfig, SharingConfig, FEES_PROGRAM_ID, FEE_CONFIG_SEED, SHARING_CONFIG_SEED};

declare_id!("BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb");

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";
pub const POOL_SEED: &[u8] = b"pool";
pub const LP_MINT_SEED: &[u8] = b"pool-lp-mint";
pub const CREATOR_VAULT_SEED: &[u8] = b"creator-vault";
pub const BOOST_VAULT_SEED: &[u8] = b"boost-vault";
/// PDA that signs the curve's `track_amm_volume` CPI (AMM volume counts toward the shared incentive campaign).
pub const VOLUME_TRACKER_SEED: &[u8] = b"volume-tracker";
/// The curve program (owner of the volume accumulators and of migration pools' creator PDA).
pub const CURVE_PROGRAM_ID: Pubkey = pubkey!("AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// Hard cap on the share of a migration pool's quote the boost vault may take.
pub const MAX_BOOST_BPS: u64 = 5_000;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_TOTAL_FEE_BPS: u64 = 1_000; // 10% hard cap on lp + protocol + creator
pub const LP_DECIMALS: u8 = 9;
/// Minimum liquidity locked forever on pool creation (prevents share-price manipulation).
pub const MINIMUM_LIQUIDITY: u64 = 1_000;

pub const DISABLE_CREATE_POOL: u8 = 1 << 0;
pub const DISABLE_DEPOSIT: u8 = 1 << 1;
pub const DISABLE_WITHDRAW: u8 = 1 << 2;
pub const DISABLE_BUY: u8 = 1 << 3;
pub const DISABLE_SELL: u8 = 1 << 4;

/// Only this key may run `create_config` (prevents a stranger from initialising the singleton).
pub const INITIAL_ADMIN: Pubkey = pubkey!("J37KbWUsm9NrVMQjS7b1UtrnxhrLjbot2m8R8REfz3jE");

#[program]
pub mod openpump_amm {
    use super::*;

    pub fn create_config(
        ctx: Context<CreateConfig>,
        lp_fee_basis_points: u64,
        protocol_fee_basis_points: u64,
        coin_creator_fee_basis_points: u64,
        protocol_fee_recipient: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INITIAL_ADMIN, AmmError::Unauthorized);
        validate_fees(lp_fee_basis_points, protocol_fee_basis_points, coin_creator_fee_basis_points)?;
        let cfg = &mut ctx.accounts.global_config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.lp_fee_basis_points = lp_fee_basis_points;
        cfg.protocol_fee_basis_points = protocol_fee_basis_points;
        cfg.coin_creator_fee_basis_points = coin_creator_fee_basis_points;
        cfg.protocol_fee_recipient = protocol_fee_recipient;
        cfg.disable_flags = 0;
        cfg.bump = ctx.bumps.global_config;
        cfg.admin_set_coin_creator_authority = ctx.accounts.admin.key();
        cfg.creator_fee_configurable = true;
        cfg.max_configurable_creator_fee_bps = 100;
        cfg.buyback_basis_points = 0;
        cfg.buyback_fee_recipient = Pubkey::default();
        cfg.boost_authority = Pubkey::default();
        cfg.boost_enabled = false;
        cfg.boost_basis_points = 2_000;
        emit_cpi!(UpdateConfigEvent {
            admin: cfg.admin,
            lp_fee_basis_points,
            protocol_fee_basis_points,
            coin_creator_fee_basis_points,
            protocol_fee_recipient,
            disable_flags: 0,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn update_fee_config(
        ctx: Context<AdminOnly>,
        lp_fee_basis_points: u64,
        protocol_fee_basis_points: u64,
        coin_creator_fee_basis_points: u64,
        protocol_fee_recipient: Pubkey,
    ) -> Result<()> {
        validate_fees(lp_fee_basis_points, protocol_fee_basis_points, coin_creator_fee_basis_points)?;
        let cfg = &mut ctx.accounts.global_config;
        cfg.lp_fee_basis_points = lp_fee_basis_points;
        cfg.protocol_fee_basis_points = protocol_fee_basis_points;
        cfg.coin_creator_fee_basis_points = coin_creator_fee_basis_points;
        cfg.protocol_fee_recipient = protocol_fee_recipient;
        emit_cpi!(UpdateConfigEvent {
            admin: cfg.admin,
            lp_fee_basis_points,
            protocol_fee_basis_points,
            coin_creator_fee_basis_points,
            protocol_fee_recipient,
            disable_flags: cfg.disable_flags,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn update_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.global_config.admin = new_admin;
        Ok(())
    }

    /// Kill switch. Bits: 1 create_pool, 2 deposit, 4 withdraw, 8 buy, 16 sell.
    pub fn disable(ctx: Context<AdminOnly>, disable_flags: u8) -> Result<()> {
        ctx.accounts.global_config.disable_flags = disable_flags;
        Ok(())
    }

    /// Share of the protocol fee (bps) routed to the buyback recipient's quote ATA on every direct swap.
    pub fn update_buyback_config(ctx: Context<AdminOnly>, buyback_basis_points: u64, buyback_fee_recipient: Pubkey) -> Result<()> {
        require!(buyback_basis_points <= BPS_DENOMINATOR, AmmError::FeeTooHigh);
        let cfg = &mut ctx.accounts.global_config;
        cfg.buyback_basis_points = buyback_basis_points;
        cfg.buyback_fee_recipient = buyback_fee_recipient;
        emit_cpi!(UpdateBuybackConfigEvent { admin: cfg.admin, buyback_basis_points, buyback_fee_recipient, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    pub fn set_boost_authority(ctx: Context<AdminOnly>, new_boost_authority: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.global_config;
        let old = cfg.boost_authority;
        cfg.boost_authority = new_boost_authority;
        emit_cpi!(BoostConfigEvent { admin: cfg.admin, boost_authority: new_boost_authority, old_boost_authority: old, boost_enabled: cfg.boost_enabled, boost_basis_points: cfg.boost_basis_points, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    pub fn toggle_boost(ctx: Context<AdminOnly>, enabled: bool) -> Result<()> {
        let cfg = &mut ctx.accounts.global_config;
        cfg.boost_enabled = enabled;
        emit_cpi!(BoostConfigEvent { admin: cfg.admin, boost_authority: cfg.boost_authority, old_boost_authority: cfg.boost_authority, boost_enabled: enabled, boost_basis_points: cfg.boost_basis_points, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Share of a migration pool's quote (bps) moved into its boost vault by `init_boost`.
    pub fn update_boost_config(ctx: Context<AdminOnly>, boost_basis_points: u64) -> Result<()> {
        require!(boost_basis_points <= MAX_BOOST_BPS, AmmError::FeeTooHigh);
        let cfg = &mut ctx.accounts.global_config;
        cfg.boost_basis_points = boost_basis_points;
        emit_cpi!(BoostConfigEvent { admin: cfg.admin, boost_authority: cfg.boost_authority, old_boost_authority: cfg.boost_authority, boost_enabled: cfg.boost_enabled, boost_basis_points, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Grow a GlobalConfig / Pool account created by an older program version to the current layout
    /// (new fields read as zero). Permissionless; the payer covers the rent delta.
    pub fn extend_account(ctx: Context<ExtendAccount>) -> Result<()> {
        let info = ctx.accounts.account.to_account_info();
        let target = {
            let data = info.try_borrow_data()?;
            require!(data.len() >= 8, AmmError::InvalidAccount);
            if data[..8] == *GlobalConfig::DISCRIMINATOR { 8 + GlobalConfig::INIT_SPACE } else if data[..8] == *Pool::DISCRIMINATOR { 8 + Pool::INIT_SPACE } else { return Err(AmmError::InvalidAccount.into()) }
        };
        require!(info.data_len() < target, AmmError::AlreadyExtended);
        let delta = Rent::get()?.minimum_balance(target).saturating_sub(info.lamports());
        if delta > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: info.clone() }),
                delta,
            )?;
        }
        info.resize(target)?;
        emit_cpi!(ExtendAccountEvent { account: info.key(), new_size: target as u64, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Move part of a freshly migrated pool's quote into its boost vault without moving the price
    /// (the pool keeps counting it as virtual quote). Only migration pools with no LP holders.
    pub fn init_boost(ctx: Context<InitBoost>) -> Result<()> {
        boost::init_boost(ctx)
    }

    /// Boost authority: spend vault quote back into the pool and burn the base it buys (price goes up).
    pub fn boost_buy_and_burn(ctx: Context<BoostBuyAndBurn>, quote_amount_in: u64, min_base_amount_burned: u64) -> Result<()> {
        boost::boost_buy_and_burn(ctx, quote_amount_in, min_base_amount_burned)
    }

    pub fn create_pool(
        ctx: Context<CreatePool>,
        index: u16,
        base_amount_in: u64,
        quote_amount_in: u64,
        coin_creator: Pubkey,
        is_holder_reward: bool,
        creator_fee_bps: u64,
        can_edit_creator_fee: bool,
    ) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.disable_flags & DISABLE_CREATE_POOL == 0, AmmError::Disabled);
        require!(base_amount_in > 0 && quote_amount_in > 0, AmmError::ZeroAmount);
        require!(creator_fee_bps <= cfg.max_configurable_creator_fee_bps, AmmError::FeeTooHigh);

        let lp_total = initial_lp_amount(base_amount_in, quote_amount_in)?;
        require!(lp_total > MINIMUM_LIQUIDITY, AmmError::InsufficientLiquidity);
        let lp_to_creator = lp_total - MINIMUM_LIQUIDITY;

        // Move the initial liquidity in.
        transfer_from_user(
            &ctx.accounts.base_token_program,
            &ctx.accounts.user_base_token_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.pool_base_token_account,
            &ctx.accounts.creator,
            base_amount_in,
        )?;
        transfer_from_user(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.user_quote_token_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.pool_quote_token_account,
            &ctx.accounts.creator,
            quote_amount_in,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.bump = ctx.bumps.pool;
        pool.index = index;
        pool.creator = ctx.accounts.creator.key();
        pool.base_mint = ctx.accounts.base_mint.key();
        pool.quote_mint = ctx.accounts.quote_mint.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.pool_base_token_account = ctx.accounts.pool_base_token_account.key();
        pool.pool_quote_token_account = ctx.accounts.pool_quote_token_account.key();
        pool.lp_supply = lp_total;
        pool.coin_creator = coin_creator;
        pool.protocol_fees = 0;
        pool.creator_fees = 0;
        pool.is_holder_reward = is_holder_reward;
        pool.creator_fee_bps = creator_fee_bps;
        pool.can_edit_creator_fee = can_edit_creator_fee && !is_holder_reward;
        pool.virtual_quote_reserves = 0;

        // Mint LP: creator share + permanently locked minimum (held by the pool's own ATA).
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.user_pool_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            ),
            lp_to_creator,
        )?;
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.locked_lp_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            ),
            MINIMUM_LIQUIDITY,
        )?;

        emit_cpi!(CreatePoolEvent {
            pool: pool.key(),
            creator: pool.creator,
            coin_creator,
            base_mint: pool.base_mint,
            quote_mint: pool.quote_mint,
            lp_mint: pool.lp_mint,
            index,
            base_amount_in,
            quote_amount_in,
            lp_minted: lp_to_creator,
            is_holder_reward,
            creator_fee_bps,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn deposit(
        ctx: Context<Liquidity>,
        lp_token_amount_out: u64,
        max_base_amount_in: u64,
        max_quote_amount_in: u64,
    ) -> Result<()> {
        require!(ctx.accounts.global_config.disable_flags & DISABLE_DEPOSIT == 0, AmmError::Disabled);
        require!(lp_token_amount_out > 0, AmmError::ZeroAmount);
        require!(ctx.accounts.pool.virtual_quote_reserves == 0, AmmError::BoostInProgress);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = ctx.accounts.pool_quote_token_account.amount;
        let lp_supply = ctx.accounts.pool.lp_supply;

        let base_in = mul_div_ceil(lp_token_amount_out, base_reserve, lp_supply)?;
        let quote_in = mul_div_ceil(lp_token_amount_out, quote_reserve, lp_supply)?;
        require!(base_in <= max_base_amount_in, AmmError::ExceededSlippage);
        require!(quote_in <= max_quote_amount_in, AmmError::ExceededSlippage);
        require!(base_in > 0 && quote_in > 0, AmmError::ZeroAmount);

        transfer_from_user(
            &ctx.accounts.base_token_program,
            &ctx.accounts.user_base_token_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.pool_base_token_account,
            &ctx.accounts.user,
            base_in,
        )?;
        transfer_from_user(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.user_quote_token_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.pool_quote_token_account,
            &ctx.accounts.user,
            quote_in,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.lp_supply = pool.lp_supply.checked_add(lp_token_amount_out).ok_or(AmmError::MathOverflow)?;
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.user_pool_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds,
            ),
            lp_token_amount_out,
        )?;

        emit_cpi!(DepositEvent {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            lp_token_amount_out,
            base_amount_in: base_in,
            quote_amount_in: quote_in,
            pool_base_reserves: base_reserve + base_in,
            pool_quote_reserves: quote_reserve + quote_in,
            lp_supply: pool.lp_supply,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn withdraw(
        ctx: Context<Liquidity>,
        lp_token_amount_in: u64,
        min_base_amount_out: u64,
        min_quote_amount_out: u64,
    ) -> Result<()> {
        require!(ctx.accounts.global_config.disable_flags & DISABLE_WITHDRAW == 0, AmmError::Disabled);
        require!(lp_token_amount_in > 0, AmmError::ZeroAmount);
        require!(ctx.accounts.pool.virtual_quote_reserves == 0, AmmError::BoostInProgress);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = ctx.accounts.pool_quote_token_account.amount;
        let lp_supply = ctx.accounts.pool.lp_supply;
        require!(lp_token_amount_in < lp_supply, AmmError::InsufficientLiquidity);

        let base_out = mul_div_floor(lp_token_amount_in, base_reserve, lp_supply)?;
        let quote_out = mul_div_floor(lp_token_amount_in, quote_reserve, lp_supply)?;
        require!(base_out >= min_base_amount_out, AmmError::ExceededSlippage);
        require!(quote_out >= min_quote_amount_out, AmmError::ExceededSlippage);

        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.user_pool_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_token_amount_in,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.lp_supply = pool.lp_supply.checked_sub(lp_token_amount_in).ok_or(AmmError::MathOverflow)?;
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        transfer_from_pool(
            &ctx.accounts.base_token_program,
            &ctx.accounts.pool_base_token_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.user_base_token_account,
            &pool.to_account_info(),
            signer_seeds,
            base_out,
        )?;
        transfer_from_pool(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.pool_quote_token_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.user_quote_token_account,
            &pool.to_account_info(),
            signer_seeds,
            quote_out,
        )?;

        emit_cpi!(WithdrawEvent {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            lp_token_amount_in,
            base_amount_out: base_out,
            quote_amount_out: quote_out,
            pool_base_reserves: base_reserve - base_out,
            pool_quote_reserves: quote_reserve - quote_out,
            lp_supply: pool.lp_supply,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Buy an exact amount of base tokens, paying at most `max_quote_amount_in` (fees included).
    /// `track_volume`: count the quote spent toward the shared volume-incentive campaign (SOL pools, both accumulators passed).
    pub fn buy(ctx: Context<Swap>, base_amount_out: u64, max_quote_amount_in: u64, track_volume: bool) -> Result<()> {
        require!(base_amount_out > 0, AmmError::ZeroAmount);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = effective_quote(&ctx.accounts.pool, &ctx.accounts.pool_quote_token_account)?;
        require!(base_amount_out < base_reserve, AmmError::InsufficientLiquidity);
        let quote_in = quote_in_for_base_out(base_amount_out, base_reserve, quote_reserve)?;
        execute_buy(ctx, base_amount_out, quote_in, max_quote_amount_in, track_volume)
    }

    /// Spend up to `spendable_quote_in` (fees included) for as much base as that buys; at least `min_base_amount_out`.
    pub fn buy_exact_quote_in(ctx: Context<Swap>, spendable_quote_in: u64, min_base_amount_out: u64, track_volume: bool) -> Result<()> {
        require!(spendable_quote_in > 0, AmmError::ZeroAmount);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = effective_quote(&ctx.accounts.pool, &ctx.accounts.pool_quote_token_account)?;
        let has_creator = ctx.accounts.pool.coin_creator != Pubkey::default();
        let mut sched = schedule(&ctx.accounts.global_config, &ctx.accounts.fee_config, base_reserve, quote_reserve, ctx.accounts.base_mint.supply, ctx.accounts.pool.quote_mint);
        if ctx.accounts.pool.creator_fee_bps > 0 { sched.creator = ctx.accounts.pool.creator_fee_bps; }
        let total_bps = sched.lp + sched.protocol + if has_creator { sched.creator } else { 0 };
        // quote_in * (1 + total_bps) <= spendable  =>  quote_in <= spendable * BPS / (BPS + total_bps)
        let budget = mul_div_floor(spendable_quote_in, BPS_DENOMINATOR, BPS_DENOMINATOR.checked_add(total_bps).ok_or(AmmError::MathOverflow)?)?;
        let mut base_out = base_out_for_quote_in(budget, base_reserve, quote_reserve)?;
        // fees round up: shave base_out until the exact total fits the budget
        let mut quote_in = 0u64;
        let mut fits = false;
        for _ in 0..8 {
            if base_out == 0 { break; }
            quote_in = quote_in_for_base_out(base_out, base_reserve, quote_reserve)?;
            let f = compute_fees(quote_in, &sched, has_creator)?;
            let total = quote_in.checked_add(f.lp).and_then(|v| v.checked_add(f.protocol)).and_then(|v| v.checked_add(f.creator)).ok_or(AmmError::MathOverflow)?;
            if total <= spendable_quote_in { fits = true; break; }
            base_out = base_out - base_out / 10_000 - 1;
        }
        require!(fits && base_out > 0, AmmError::ZeroAmount);
        require!(base_out >= min_base_amount_out, AmmError::ExceededSlippage);
        execute_buy(ctx, base_out, quote_in, spendable_quote_in, track_volume)
    }

    /// Sell an exact amount of base tokens, receiving at least `min_quote_amount_out` (after fees).
    pub fn sell(ctx: Context<Swap>, base_amount_in: u64, min_quote_amount_out: u64) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.disable_flags & DISABLE_SELL == 0, AmmError::Disabled);
        require!(base_amount_in > 0, AmmError::ZeroAmount);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = effective_quote(&ctx.accounts.pool, &ctx.accounts.pool_quote_token_account)?;

        let quote_out = quote_out_for_base_in(base_amount_in, base_reserve, quote_reserve)?;
        // the vault's virtual quote is not in the pool: a sell can only pay out of real reserves
        require!(quote_out <= ctx.accounts.pool_quote_token_account.amount, AmmError::InsufficientLiquidity);
        let has_creator = ctx.accounts.pool.coin_creator != Pubkey::default();
        let mut sched = schedule(cfg, &ctx.accounts.fee_config, base_reserve, quote_reserve, ctx.accounts.base_mint.supply, ctx.accounts.pool.quote_mint);
        if ctx.accounts.pool.creator_fee_bps > 0 { sched.creator = ctx.accounts.pool.creator_fee_bps; }
        let fees = compute_fees(quote_out, &sched, has_creator)?;
        let total_fees = fees
            .lp
            .checked_add(fees.protocol)
            .and_then(|v| v.checked_add(fees.creator))
            .ok_or(AmmError::MathOverflow)?;
        let user_out = quote_out.checked_sub(total_fees).ok_or(AmmError::MathOverflow)?;
        require!(user_out >= min_quote_amount_out, AmmError::ExceededSlippage);
        require!(user_out > 0, AmmError::ZeroAmount);

        transfer_from_user(
            &ctx.accounts.base_token_program,
            &ctx.accounts.user_base_token_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.pool_base_token_account,
            &ctx.accounts.user,
            base_amount_in,
        )?;

        let pool = &mut ctx.accounts.pool;
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        transfer_from_pool(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.pool_quote_token_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.user_quote_token_account,
            &pool.to_account_info(),
            signer_seeds,
            user_out,
        )?;
        let buyback_fee = buyback_split(cfg, &ctx.accounts.buyback_fee_recipient_token_account, fees.protocol)?;
        if fees.protocol - buyback_fee > 0 {
            transfer_from_pool(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.pool_quote_token_account,
                &ctx.accounts.quote_mint,
                &ctx.accounts.protocol_fee_recipient_token_account,
                &pool.to_account_info(),
                signer_seeds,
                fees.protocol - buyback_fee,
            )?;
        }
        if let (Some(bb), true) = (&ctx.accounts.buyback_fee_recipient_token_account, buyback_fee > 0) {
            transfer_from_pool(&ctx.accounts.quote_token_program, &ctx.accounts.pool_quote_token_account, &ctx.accounts.quote_mint, bb, &pool.to_account_info(), signer_seeds, buyback_fee)?;
        }
        if fees.creator > 0 {
            transfer_from_pool(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.pool_quote_token_account,
                &ctx.accounts.quote_mint,
                &ctx.accounts.coin_creator_vault_ata,
                &pool.to_account_info(),
                signer_seeds,
                fees.creator,
            )?;
        }
        pool.protocol_fees = pool.protocol_fees.saturating_add(fees.protocol);
        pool.creator_fees = pool.creator_fees.saturating_add(fees.creator);

        emit_cpi!(SellEvent {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            base_amount_in,
            quote_amount_out: quote_out,
            lp_fee: fees.lp,
            protocol_fee: fees.protocol,
            coin_creator_fee: fees.creator,
            user_quote_amount_out: user_out,
            pool_base_reserves: base_reserve + base_amount_in,
            pool_quote_reserves: quote_reserve - user_out - fees.protocol - fees.creator,
            virtual_quote_reserves: pool.virtual_quote_reserves,
            buyback_fee,
            coin_creator: pool.coin_creator,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Route through up to 4 pools in one instruction (see multihop.rs for the remaining-accounts layout).
    pub fn multi_hop_swap<'info>(ctx: Context<'_, '_, 'info, 'info, MultiHopSwap<'info>>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        multihop::multi_hop_swap(ctx, amount_in, min_amount_out)
    }

    /// Protocol: community takeover of a pool's coin creator (mirrors the curve's admin_cto).
    pub fn admin_cto_pool(ctx: Context<AdminCtoPool>, coin_creator: Pubkey, is_holder_reward: bool, creator_fee_bps: Option<u64>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.is_holder_reward, AmmError::HolderRewardCreatorImmutable);
        if let Some(bps) = creator_fee_bps {
            require!(bps <= ctx.accounts.global_config.max_configurable_creator_fee_bps, AmmError::FeeTooHigh);
            pool.creator_fee_bps = bps;
        }
        let old = pool.coin_creator;
        pool.coin_creator = coin_creator;
        pool.is_holder_reward = is_holder_reward;
        if is_holder_reward { pool.can_edit_creator_fee = false; }
        emit_cpi!(AdminCtoPoolEvent { pool: pool.key(), authority: ctx.accounts.authority.key(), old_coin_creator: old, new_coin_creator: coin_creator, is_holder_reward, creator_fee_bps: pool.creator_fee_bps, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }
    pub fn update_creator_fee_config(ctx: Context<AdminOnly>, creator_fee_configurable: bool, max_configurable_creator_fee_bps: u64, admin_set_coin_creator_authority: Pubkey) -> Result<()> {
        require!(max_configurable_creator_fee_bps <= MAX_TOTAL_FEE_BPS, AmmError::FeeTooHigh);
        let cfg = &mut ctx.accounts.global_config;
        cfg.creator_fee_configurable = creator_fee_configurable;
        cfg.max_configurable_creator_fee_bps = max_configurable_creator_fee_bps;
        cfg.admin_set_coin_creator_authority = admin_set_coin_creator_authority;
        Ok(())
    }
    /// Coin creator sets the pool's creator fee (0 = schedule) within the ceiling; `lock` makes it final.
    pub fn set_coin_creator_fee_bps(ctx: Context<SetCoinCreator>, creator_fee_bps: u64, lock: bool) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.creator_fee_configurable, AmmError::CreatorFeeNotConfigurable);
        require!(creator_fee_bps <= cfg.max_configurable_creator_fee_bps, AmmError::FeeTooHigh);
        let pool = &mut ctx.accounts.pool;
        require!(pool.can_edit_creator_fee, AmmError::CreatorFeeLocked);
        pool.creator_fee_bps = creator_fee_bps;
        if lock { pool.can_edit_creator_fee = false; }
        Ok(())
    }

    /// The current coin creator hands the fee stream to another address (e.g. a fees-program sharing PDA).
    pub fn set_coin_creator(ctx: Context<SetCoinCreator>, new_coin_creator: Pubkey) -> Result<()> {
        require!(new_coin_creator != Pubkey::default(), AmmError::ZeroAmount);
        let pool = &mut ctx.accounts.pool;
        let old = pool.coin_creator;
        pool.coin_creator = new_coin_creator;
        emit_cpi!(SetCoinCreatorEvent { pool: pool.key(), old_coin_creator: old, new_coin_creator, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Permissionless: split a sharing-config coin creator's vault among its shareholders
    /// (remaining accounts: wallets..., then their quote ATAs...).
    pub fn distribute_coin_creator_fees<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeCoinCreatorFees<'info>>, initialize_ata: bool) -> Result<()> {
        let cfg = &ctx.accounts.sharing_config;
        require!(cfg.status == ConfigStatus::Active, AmmError::SharingNotActive);
        let n = cfg.shareholders.len();
        require!(ctx.remaining_accounts.len() >= n * 2, AmmError::RecipientsMismatch);
        let available = ctx.accounts.coin_creator_vault_ata.amount;
        if available == 0 {
            return Ok(());
        }
        let sharing_key = cfg.key();
        let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, sharing_key.as_ref(), &[ctx.bumps.coin_creator_vault_authority]];
        let quote_mint = ctx.accounts.quote_mint.key();
        let tp = ctx.accounts.quote_token_program.key();
        let dec = ctx.accounts.quote_mint.decimals;
        let mut distributed = 0u64;
        for (i, sh) in cfg.shareholders.iter().enumerate() {
            let wallet = &ctx.remaining_accounts[i];
            let ata = &ctx.remaining_accounts[n + i];
            require_keys_eq!(wallet.key(), sh.address, AmmError::RecipientsMismatch);
            require_keys_eq!(ata.key(), anchor_spl::associated_token::get_associated_token_address_with_program_id(wallet.key, &quote_mint, &tp), AmmError::RecipientsMismatch);
            let amount = ((available as u128) * (sh.share_bps as u128) / 10_000) as u64;
            if amount == 0 {
                continue;
            }
            if ata.data_is_empty() {
                require!(initialize_ata, AmmError::RecipientsMismatch);
                anchor_lang::solana_program::program::invoke(
                    &anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(ctx.accounts.payer.key, wallet.key, &quote_mint, &tp),
                    &[ctx.accounts.payer.to_account_info(), ata.clone(), wallet.clone(), ctx.accounts.quote_mint.to_account_info(), ctx.accounts.system_program.to_account_info(), ctx.accounts.quote_token_program.to_account_info(), ctx.accounts.associated_token_program.to_account_info()],
                )?;
            }
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.quote_token_program.to_account_info(),
                    TransferChecked { from: ctx.accounts.coin_creator_vault_ata.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ata.clone(), authority: ctx.accounts.coin_creator_vault_authority.to_account_info() },
                    &[seeds],
                ),
                amount,
                dec,
            )?;
            distributed = distributed.checked_add(amount).ok_or(AmmError::MathOverflow)?;
        }
        emit_cpi!(DistributeCoinCreatorFeesEvent { pool: ctx.accounts.pool.key(), sharing_config: sharing_key, quote_mint, distributed, recipients: n as u64, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// The coin creator sweeps everything in their vault for `quote_mint` into their own ATA.
    pub fn collect_coin_creator_fee(ctx: Context<CollectCoinCreatorFee>) -> Result<()> {
        let amount = ctx.accounts.coin_creator_vault_ata.amount;
        require!(amount > 0, AmmError::ZeroAmount);
        let creator_key = ctx.accounts.coin_creator.key();
        let bump = ctx.bumps.coin_creator_vault_authority;
        let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, creator_key.as_ref(), &[bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.coin_creator_vault_ata.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.coin_creator_token_account.to_account_info(),
                    authority: ctx.accounts.coin_creator_vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        emit_cpi!(CollectCoinCreatorFeeEvent {
            coin_creator: creator_key,
            quote_mint: ctx.accounts.quote_mint.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------- helpers

#[macro_export]
macro_rules! pool_seeds {
    ($pool:expr) => {
        &[
            $crate::POOL_SEED,
            &$pool.index.to_le_bytes(),
            $pool.creator.as_ref(),
            $pool.base_mint.as_ref(),
            $pool.quote_mint.as_ref(),
            &[$pool.bump],
        ]
    };
}

fn validate_fees(lp: u64, protocol: u64, creator: u64) -> Result<()> {
    let total = lp.checked_add(protocol).and_then(|v| v.checked_add(creator)).ok_or(AmmError::MathOverflow)?;
    require!(total <= MAX_TOTAL_FEE_BPS, AmmError::FeeTooHigh);
    Ok(())
}

pub struct Fees {
    pub lp: u64,
    pub protocol: u64,
    pub creator: u64,
}

/// bps schedule for a swap: the fees program's market-cap tier when a FeeConfig is passed,
/// otherwise the AMM's flat config. Market cap = spot price × mint supply, in quote units.
pub struct Schedule { pub lp: u64, pub protocol: u64, pub creator: u64 }
pub fn schedule(cfg: &GlobalConfig, fee_config: &Option<Box<Account<FeeConfig>>>, base_reserve: u64, quote_reserve: u64, supply: u64, quote_mint: Pubkey) -> Schedule {
    if let Some(fc) = fee_config {
        let mcap = openpump_fee_types::market_cap(quote_reserve, base_reserve, supply);
        let f = openpump_fee_types::fees_for(fc, true, mcap, quote_mint);
        Schedule { lp: f.lp_fee_bps, protocol: f.protocol_fee_bps, creator: f.creator_fee_bps }
    } else {
        Schedule { lp: cfg.lp_fee_basis_points, protocol: cfg.protocol_fee_basis_points, creator: cfg.coin_creator_fee_basis_points }
    }
}

pub fn compute_fees(amount: u64, s: &Schedule, has_creator: bool) -> Result<Fees> {
    Ok(Fees {
        lp: fee_ceil(amount, s.lp)?,
        protocol: fee_ceil(amount, s.protocol)?,
        creator: if has_creator { fee_ceil(amount, s.creator)? } else { 0 },
    })
}

/// Quote reserve the price is computed against: real tokens in the pool + the boost vault's virtual share.
pub fn effective_quote(pool: &Pool, quote_account: &InterfaceAccount<TokenAccount>) -> Result<u64> {
    quote_account.amount.checked_add(pool.virtual_quote_reserves).ok_or(AmmError::MathOverflow.into())
}

fn buyback_split(cfg: &GlobalConfig, recipient: &Option<Box<InterfaceAccount<TokenAccount>>>, protocol_fee: u64) -> Result<u64> {
    Ok(match recipient {
        Some(_) if cfg.buyback_basis_points > 0 => mul_div_floor(protocol_fee, cfg.buyback_basis_points, BPS_DENOMINATOR)?,
        _ => 0,
    })
}

/// Common buy body: `quote_in` is the pool leg already computed against the effective reserves.
fn execute_buy(ctx: Context<Swap>, base_amount_out: u64, quote_in: u64, max_quote_amount_in: u64, track_volume: bool) -> Result<()> {
    let cfg = &ctx.accounts.global_config;
    require!(cfg.disable_flags & DISABLE_BUY == 0, AmmError::Disabled);
    let base_reserve = ctx.accounts.pool_base_token_account.amount;
    let quote_reserve = effective_quote(&ctx.accounts.pool, &ctx.accounts.pool_quote_token_account)?;
    let has_creator = ctx.accounts.pool.coin_creator != Pubkey::default();
    let mut sched = schedule(cfg, &ctx.accounts.fee_config, base_reserve, quote_reserve, ctx.accounts.base_mint.supply, ctx.accounts.pool.quote_mint);
    if ctx.accounts.pool.creator_fee_bps > 0 { sched.creator = ctx.accounts.pool.creator_fee_bps; }
    let fees = compute_fees(quote_in, &sched, has_creator)?;
    let total_in = quote_in
        .checked_add(fees.lp)
        .and_then(|v| v.checked_add(fees.protocol))
        .and_then(|v| v.checked_add(fees.creator))
        .ok_or(AmmError::MathOverflow)?;
    require!(total_in <= max_quote_amount_in, AmmError::ExceededSlippage);
    let buyback_fee = buyback_split(cfg, &ctx.accounts.buyback_fee_recipient_token_account, fees.protocol)?;

    // quote in: pool gets swap amount + lp fee; protocol (+ buyback) + creator get theirs.
    transfer_from_user(&ctx.accounts.quote_token_program, &ctx.accounts.user_quote_token_account, &ctx.accounts.quote_mint, &ctx.accounts.pool_quote_token_account, &ctx.accounts.user, quote_in + fees.lp)?;
    if fees.protocol - buyback_fee > 0 {
        transfer_from_user(&ctx.accounts.quote_token_program, &ctx.accounts.user_quote_token_account, &ctx.accounts.quote_mint, &ctx.accounts.protocol_fee_recipient_token_account, &ctx.accounts.user, fees.protocol - buyback_fee)?;
    }
    if let (Some(bb), true) = (&ctx.accounts.buyback_fee_recipient_token_account, buyback_fee > 0) {
        transfer_from_user(&ctx.accounts.quote_token_program, &ctx.accounts.user_quote_token_account, &ctx.accounts.quote_mint, bb, &ctx.accounts.user, buyback_fee)?;
    }
    if fees.creator > 0 {
        transfer_from_user(&ctx.accounts.quote_token_program, &ctx.accounts.user_quote_token_account, &ctx.accounts.quote_mint, &ctx.accounts.coin_creator_vault_ata, &ctx.accounts.user, fees.creator)?;
    }

    {
        let pool = &mut ctx.accounts.pool;
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        transfer_from_pool(&ctx.accounts.base_token_program, &ctx.accounts.pool_base_token_account, &ctx.accounts.base_mint, &ctx.accounts.user_base_token_account, &pool.to_account_info(), signer_seeds, base_amount_out)?;
        pool.protocol_fees = pool.protocol_fees.saturating_add(fees.protocol);
        pool.creator_fees = pool.creator_fees.saturating_add(fees.creator);
    }

    // volume incentives: SOL pools only, opt-in, counted in the curve program's shared campaign
    let tracked = track_volume && ctx.accounts.pool.quote_mint == WSOL_MINT && track_amm_volume(&ctx, quote_in)?;
    let pool = &ctx.accounts.pool;

    emit_cpi!(BuyEvent {
        pool: pool.key(),
        user: ctx.accounts.user.key(),
        base_amount_out,
        quote_amount_in: quote_in,
        lp_fee: fees.lp,
        protocol_fee: fees.protocol,
        coin_creator_fee: fees.creator,
        quote_amount_in_with_fees: total_in,
        pool_base_reserves: base_reserve - base_amount_out,
        pool_quote_reserves: quote_reserve + quote_in + fees.lp,
        virtual_quote_reserves: pool.virtual_quote_reserves,
        buyback_fee,
        track_volume: tracked,
        coin_creator: pool.coin_creator,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

/// CPI `openpump_curve::track_amm_volume(sol)` signed by our volume-tracker PDA. Returns false when the
/// optional accumulator accounts were not passed. (Built by hand: the curve crate depends on this one.)
fn track_amm_volume(ctx: &Context<Swap>, sol: u64) -> Result<bool> {
    let (Some(g), Some(u), Some(curve)) = (&ctx.accounts.global_volume_accumulator, &ctx.accounts.user_volume_accumulator, &ctx.accounts.curve_program) else { return Ok(false) };
    let mut data = anchor_lang::solana_program::hash::hash(b"global:track_amm_volume").to_bytes()[..8].to_vec();
    data.extend_from_slice(&sol.to_le_bytes());
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: CURVE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.user.key(), false),
            AccountMeta::new(g.key(), false),
            AccountMeta::new(u.key(), false),
            AccountMeta::new_readonly(ctx.accounts.volume_tracker.key(), true),
        ],
        data,
    };
    let bump = [ctx.bumps.volume_tracker];
    let seeds: &[&[u8]] = &[VOLUME_TRACKER_SEED, &bump];
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[ctx.accounts.user.to_account_info(), g.to_account_info(), u.to_account_info(), ctx.accounts.volume_tracker.to_account_info(), curve.to_account_info()],
        &[seeds],
    )?;
    Ok(true)
}

fn transfer_from_user<'info>(
    program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new(
            program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

fn transfer_from_pool<'info>(
    program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    pool: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: pool.clone(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct CreateConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + GlobalConfig::INIT_SPACE, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump, has_one = admin @ AmmError::Unauthorized)]
    pub global_config: Account<'info, GlobalConfig>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u16, base_amount_in: u64, quote_amount_in: u64, coin_creator: Pubkey)]
pub struct CreatePool<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &index.to_le_bytes(), creator.key().as_ref(), base_mint.key().as_ref(), quote_mint.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    /// Owner of the initial liquidity. May be a PDA of another program (the curve) signing via CPI.
    pub creator: Signer<'info>,
    /// Pays rent for the new accounts (the curve passes the migrating user here).
    #[account(mut)]
    pub payer: Signer<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        seeds = [LP_MINT_SEED, pool.key().as_ref()],
        bump,
        mint::decimals = LP_DECIMALS,
        mint::authority = pool,
        mint::token_program = token_program,
    )]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = creator, token::token_program = base_token_program)]
    pub user_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = creator, token::token_program = quote_token_program)]
    pub user_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = lp_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program,
    )]
    pub user_pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Holds MINIMUM_LIQUIDITY LP forever (owned by the pool PDA, which never signs a burn/transfer of it).
    #[account(
        init,
        payer = payer,
        associated_token::mint = lp_mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub locked_lp_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = pool,
        associated_token::token_program = base_token_program,
    )]
    pub pool_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = pool,
        associated_token::token_program = quote_token_program,
    )]
    pub pool_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA that owns the coin creator's fee vault; only used as an ATA authority.
    #[account(seeds = [CREATOR_VAULT_SEED, coin_creator.as_ref()], bump)]
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    /// Created here so buy/sell never need to init accounts.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = coin_creator_vault_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_creator_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Token program for the LP mint (classic SPL Token).
    pub token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Liquidity<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = lp_mint,
        has_one = pool_base_token_account, has_one = pool_quote_token_account,
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = user, token::token_program = base_token_program)]
    pub user_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = user, token::token_program = quote_token_program)]
    pub user_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pool_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pool_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
        has_one = base_mint, has_one = quote_mint,
        has_one = pool_base_token_account, has_one = pool_quote_token_account,
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = base_mint,
        associated_token::authority = user,
        associated_token::token_program = base_token_program,
    )]
    pub user_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = user, token::token_program = quote_token_program)]
    pub user_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pool_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pool_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(address = global_config.protocol_fee_recipient @ AmmError::InvalidFeeRecipient)]
    pub protocol_fee_recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = quote_mint,
        associated_token::authority = protocol_fee_recipient,
        associated_token::token_program = quote_token_program,
    )]
    pub protocol_fee_recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA owning the coin creator's vault.
    #[account(seeds = [CREATOR_VAULT_SEED, pool.coin_creator.as_ref()], bump)]
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = coin_creator_vault_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_creator_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// Optional: the fees program's tiered schedule (market-cap based).
    #[account(seeds = [FEE_CONFIG_SEED], bump = fee_config.bump, seeds::program = FEES_PROGRAM_ID)]
    pub fee_config: Option<Box<Account<'info, FeeConfig>>>,
    /// Optional: quote ATA of `global_config.buyback_fee_recipient`; receives the buyback share of the protocol fee.
    #[account(mut, token::mint = quote_mint, token::token_program = quote_token_program, constraint = buyback_fee_recipient_token_account.owner == global_config.buyback_fee_recipient @ AmmError::InvalidFeeRecipient)]
    pub buyback_fee_recipient_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: optional, the curve program's global volume accumulator (validated by the curve on CPI).
    #[account(mut)]
    pub global_volume_accumulator: Option<UncheckedAccount<'info>>,
    /// CHECK: optional, the user's volume accumulator in the curve program (validated by the curve on CPI).
    #[account(mut)]
    pub user_volume_accumulator: Option<UncheckedAccount<'info>>,
    /// CHECK: PDA signing the volume CPI.
    #[account(seeds = [VOLUME_TRACKER_SEED], bump)]
    pub volume_tracker: UncheckedAccount<'info>,
    /// CHECK: the curve program, required to track volume.
    #[account(address = CURVE_PROGRAM_ID)]
    pub curve_program: Option<UncheckedAccount<'info>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ExtendAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: a GlobalConfig or Pool owned by this program; discriminator checked in the handler.
    #[account(mut, owner = crate::ID @ AmmError::InvalidAccount)]
    pub account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetCoinCreator<'info> {
    pub coin_creator: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump, has_one = coin_creator @ AmmError::Unauthorized)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminCtoPool<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump, constraint = global_config.admin_set_coin_creator_authority == authority.key() @ AmmError::Unauthorized)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DistributeCoinCreatorFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump, has_one = quote_mint, constraint = pool.coin_creator == sharing_config.key() @ AmmError::SharingMismatch)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [SHARING_CONFIG_SEED, pool.base_mint.as_ref()], bump = sharing_config.bump, seeds::program = FEES_PROGRAM_ID, constraint = sharing_config.mint == pool.base_mint @ AmmError::SharingMismatch)]
    pub sharing_config: Box<Account<'info, SharingConfig>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: PDA owning the sharing config's AMM fee vault.
    #[account(seeds = [CREATOR_VAULT_SEED, sharing_config.key().as_ref()], bump)]
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = coin_creator_vault_authority, associated_token::token_program = quote_token_program)]
    pub coin_creator_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CollectCoinCreatorFee<'info> {
    #[account(mut)]
    pub coin_creator: Signer<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: PDA owning the coin creator's vault.
    #[account(seeds = [CREATOR_VAULT_SEED, coin_creator.key().as_ref()], bump)]
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = coin_creator_vault_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_creator_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = coin_creator,
        associated_token::mint = quote_mint,
        associated_token::authority = coin_creator,
        associated_token::token_program = quote_token_program,
    )]
    pub coin_creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub lp_fee_basis_points: u64,
    pub protocol_fee_basis_points: u64,
    pub coin_creator_fee_basis_points: u64,
    pub protocol_fee_recipient: Pubkey,
    pub disable_flags: u8,
    pub bump: u8,
    pub admin_set_coin_creator_authority: Pubkey,
    pub creator_fee_configurable: bool,
    pub max_configurable_creator_fee_bps: u64,
    /// Share of the protocol fee (bps) sent to `buyback_fee_recipient`'s quote ATA on direct swaps.
    pub buyback_basis_points: u64,
    pub buyback_fee_recipient: Pubkey,
    /// Boost: migration pools park `boost_basis_points` of their quote in a vault the authority spends on buy-and-burns.
    pub boost_authority: Pubkey,
    pub boost_enabled: bool,
    pub boost_basis_points: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub bump: u8,
    pub index: u16,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    pub lp_supply: u64,
    pub coin_creator: Pubkey,
    /// Lifetime stats (informational).
    pub protocol_fees: u64,
    pub creator_fees: u64,
    pub is_holder_reward: bool,
    /// Per-pool creator fee override (bps). 0 = follow the schedule.
    pub creator_fee_bps: u64,
    pub can_edit_creator_fee: bool,
    /// Quote parked in the boost vault but still priced as if in the pool (see boost.rs).
    pub virtual_quote_reserves: u64,
}

// ---------------------------------------------------------------- events

#[event]
pub struct UpdateConfigEvent {
    pub admin: Pubkey,
    pub lp_fee_basis_points: u64,
    pub protocol_fee_basis_points: u64,
    pub coin_creator_fee_basis_points: u64,
    pub protocol_fee_recipient: Pubkey,
    pub disable_flags: u8,
    pub timestamp: i64,
}

#[event]
pub struct CreatePoolEvent {
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub coin_creator: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub index: u16,
    pub base_amount_in: u64,
    pub quote_amount_in: u64,
    pub lp_minted: u64,
    pub is_holder_reward: bool,
    pub creator_fee_bps: u64,
    pub timestamp: i64,
}

#[event]
pub struct DepositEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub lp_token_amount_out: u64,
    pub base_amount_in: u64,
    pub quote_amount_in: u64,
    pub pool_base_reserves: u64,
    pub pool_quote_reserves: u64,
    pub lp_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub lp_token_amount_in: u64,
    pub base_amount_out: u64,
    pub quote_amount_out: u64,
    pub pool_base_reserves: u64,
    pub pool_quote_reserves: u64,
    pub lp_supply: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuyEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub base_amount_out: u64,
    pub quote_amount_in: u64,
    pub lp_fee: u64,
    pub protocol_fee: u64,
    pub coin_creator_fee: u64,
    pub quote_amount_in_with_fees: u64,
    pub pool_base_reserves: u64,
    pub pool_quote_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub buyback_fee: u64,
    pub track_volume: bool,
    pub coin_creator: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SellEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub base_amount_in: u64,
    pub quote_amount_out: u64,
    pub lp_fee: u64,
    pub protocol_fee: u64,
    pub coin_creator_fee: u64,
    pub user_quote_amount_out: u64,
    pub pool_base_reserves: u64,
    pub pool_quote_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub buyback_fee: u64,
    pub coin_creator: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UpdateBuybackConfigEvent { pub admin: Pubkey, pub buyback_basis_points: u64, pub buyback_fee_recipient: Pubkey, pub timestamp: i64 }
#[event]
pub struct BoostConfigEvent { pub admin: Pubkey, pub boost_authority: Pubkey, pub old_boost_authority: Pubkey, pub boost_enabled: bool, pub boost_basis_points: u64, pub timestamp: i64 }
#[event]
pub struct ExtendAccountEvent { pub account: Pubkey, pub new_size: u64, pub timestamp: i64 }

#[event]
pub struct AdminCtoPoolEvent { pub pool: Pubkey, pub authority: Pubkey, pub old_coin_creator: Pubkey, pub new_coin_creator: Pubkey, pub is_holder_reward: bool, pub creator_fee_bps: u64, pub timestamp: i64 }
#[event]
pub struct SetCoinCreatorEvent { pub pool: Pubkey, pub old_coin_creator: Pubkey, pub new_coin_creator: Pubkey, pub timestamp: i64 }
#[event]
pub struct DistributeCoinCreatorFeesEvent { pub pool: Pubkey, pub sharing_config: Pubkey, pub quote_mint: Pubkey, pub distributed: u64, pub recipients: u64, pub timestamp: i64 }

#[event]
pub struct CollectCoinCreatorFeeEvent {
    pub coin_creator: Pubkey,
    pub quote_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum AmmError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("This instruction is disabled")]
    Disabled,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Slippage limit exceeded")]
    ExceededSlippage,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid protocol fee recipient")]
    InvalidFeeRecipient,
    #[msg("Sharing config is not active")]
    SharingNotActive,
    #[msg("Sharing config does not match this pool")]
    SharingMismatch,
    #[msg("Shareholders and remaining accounts do not match")]
    RecipientsMismatch,
    #[msg("The creator of a holder-reward pool cannot be changed")]
    HolderRewardCreatorImmutable,
    #[msg("Creator fee is not configurable")]
    CreatorFeeNotConfigurable,
    #[msg("Creator fee is locked for this pool")]
    CreatorFeeLocked,
    #[msg("Boost is disabled")]
    BoostDisabled,
    #[msg("Pool already has a boost in flight")]
    AlreadyBoosted,
    #[msg("Only migration pools can be boosted")]
    NotMigrationPool,
    #[msg("Pool has liquidity providers")]
    PoolHasLiquidityProviders,
    #[msg("Liquidity is locked while a boost is in flight")]
    BoostInProgress,
    #[msg("Nothing to boost")]
    NothingToBoost,
    #[msg("Not an account of this program")]
    InvalidAccount,
    #[msg("Account already has the current layout")]
    AlreadyExtended,
}
