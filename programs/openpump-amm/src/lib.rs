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

declare_id!("BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb");

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";
pub const POOL_SEED: &[u8] = b"pool";
pub const LP_MINT_SEED: &[u8] = b"pool-lp-mint";
pub const CREATOR_VAULT_SEED: &[u8] = b"creator-vault";

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

    pub fn create_pool(
        ctx: Context<CreatePool>,
        index: u16,
        base_amount_in: u64,
        quote_amount_in: u64,
        coin_creator: Pubkey,
    ) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.disable_flags & DISABLE_CREATE_POOL == 0, AmmError::Disabled);
        require!(base_amount_in > 0 && quote_amount_in > 0, AmmError::ZeroAmount);

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
    pub fn buy(ctx: Context<Swap>, base_amount_out: u64, max_quote_amount_in: u64) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.disable_flags & DISABLE_BUY == 0, AmmError::Disabled);
        require!(base_amount_out > 0, AmmError::ZeroAmount);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = ctx.accounts.pool_quote_token_account.amount;
        require!(base_amount_out < base_reserve, AmmError::InsufficientLiquidity);

        let quote_in = quote_in_for_base_out(base_amount_out, base_reserve, quote_reserve)?;
        let has_creator = ctx.accounts.pool.coin_creator != Pubkey::default();
        let fees = compute_fees(quote_in, cfg, has_creator)?;
        let total_in = quote_in
            .checked_add(fees.lp)
            .and_then(|v| v.checked_add(fees.protocol))
            .and_then(|v| v.checked_add(fees.creator))
            .ok_or(AmmError::MathOverflow)?;
        require!(total_in <= max_quote_amount_in, AmmError::ExceededSlippage);

        // quote in: pool gets swap amount + lp fee; protocol + creator get theirs.
        transfer_from_user(
            &ctx.accounts.quote_token_program,
            &ctx.accounts.user_quote_token_account,
            &ctx.accounts.quote_mint,
            &ctx.accounts.pool_quote_token_account,
            &ctx.accounts.user,
            quote_in + fees.lp,
        )?;
        if fees.protocol > 0 {
            transfer_from_user(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.user_quote_token_account,
                &ctx.accounts.quote_mint,
                &ctx.accounts.protocol_fee_recipient_token_account,
                &ctx.accounts.user,
                fees.protocol,
            )?;
        }
        if fees.creator > 0 {
            transfer_from_user(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.user_quote_token_account,
                &ctx.accounts.quote_mint,
                &ctx.accounts.coin_creator_vault_ata,
                &ctx.accounts.user,
                fees.creator,
            )?;
        }

        let pool = &mut ctx.accounts.pool;
        let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
        transfer_from_pool(
            &ctx.accounts.base_token_program,
            &ctx.accounts.pool_base_token_account,
            &ctx.accounts.base_mint,
            &ctx.accounts.user_base_token_account,
            &pool.to_account_info(),
            signer_seeds,
            base_amount_out,
        )?;
        pool.protocol_fees = pool.protocol_fees.saturating_add(fees.protocol);
        pool.creator_fees = pool.creator_fees.saturating_add(fees.creator);

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
            coin_creator: pool.coin_creator,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Sell an exact amount of base tokens, receiving at least `min_quote_amount_out` (after fees).
    pub fn sell(ctx: Context<Swap>, base_amount_in: u64, min_quote_amount_out: u64) -> Result<()> {
        let cfg = &ctx.accounts.global_config;
        require!(cfg.disable_flags & DISABLE_SELL == 0, AmmError::Disabled);
        require!(base_amount_in > 0, AmmError::ZeroAmount);
        let base_reserve = ctx.accounts.pool_base_token_account.amount;
        let quote_reserve = ctx.accounts.pool_quote_token_account.amount;

        let quote_out = quote_out_for_base_in(base_amount_in, base_reserve, quote_reserve)?;
        let has_creator = ctx.accounts.pool.coin_creator != Pubkey::default();
        let fees = compute_fees(quote_out, cfg, has_creator)?;
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
        if fees.protocol > 0 {
            transfer_from_pool(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.pool_quote_token_account,
                &ctx.accounts.quote_mint,
                &ctx.accounts.protocol_fee_recipient_token_account,
                &pool.to_account_info(),
                signer_seeds,
                fees.protocol,
            )?;
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
            coin_creator: pool.coin_creator,
            timestamp: Clock::get()?.unix_timestamp,
        });
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

pub fn compute_fees(amount: u64, cfg: &GlobalConfig, has_creator: bool) -> Result<Fees> {
    Ok(Fees {
        lp: fee_ceil(amount, cfg.lp_fee_basis_points)?,
        protocol: fee_ceil(amount, cfg.protocol_fee_basis_points)?,
        creator: if has_creator { fee_ceil(amount, cfg.coin_creator_fee_basis_points)? } else { 0 },
    })
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
    pub coin_creator: Pubkey,
    pub timestamp: i64,
}

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
}
