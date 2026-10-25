//! Boost: a delayed buy-and-burn for graduated coins (pump.fun's `init_boost` / `boost_buy_and_burn`).
//!
//! `init_boost` moves `boost_basis_points` of a freshly migrated pool's quote into a vault PDA and
//! records the same amount as `virtual_quote_reserves`, so the pool keeps pricing as if the quote were
//! still inside it: no price move, but LP deposits/withdrawals are locked until the boost completes.
//! The boost authority then calls `boost_buy_and_burn` in slices: vault quote goes back into the pool
//! and the base that amount would have bought at the effective price is burned (price goes up).
//! When the vault is empty it is closed and the pool is a plain constant-product pool again.

use crate::*;

pub fn init_boost(ctx: Context<InitBoost>) -> Result<()> {
    let cfg = &ctx.accounts.global_config;
    require!(cfg.boost_enabled, AmmError::BoostDisabled);
    let pool = &ctx.accounts.pool;
    require!(pool.virtual_quote_reserves == 0, AmmError::AlreadyBoosted);
    // Only migration pools (creator = the coin's bonding-curve PDA, whose LP was burned at migration):
    // with no LP holders the vault takes value from nobody.
    let bc = Pubkey::find_program_address(&[b"bonding-curve", pool.base_mint.as_ref()], &CURVE_PROGRAM_ID).0;
    require_keys_eq!(pool.creator, bc, AmmError::NotMigrationPool);
    require!(ctx.accounts.lp_mint.supply == MINIMUM_LIQUIDITY, AmmError::PoolHasLiquidityProviders);

    let real_quote = ctx.accounts.pool_quote_token_account.amount;
    let amount = mul_div_floor(real_quote, cfg.boost_basis_points, BPS_DENOMINATOR)?;
    require!(amount > 0 && amount < real_quote, AmmError::NothingToBoost);

    let pool = &mut ctx.accounts.pool;
    let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.pool_quote_token_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.boost_vault.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;
    pool.virtual_quote_reserves = amount;
    emit_cpi!(InitBoostEvent {
        pool: pool.key(),
        mint: pool.base_mint,
        quote_mint: pool.quote_mint,
        virtual_quote_reserves: amount,
        real_quote_reserves_after: real_quote - amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn boost_buy_and_burn(ctx: Context<BoostBuyAndBurn>, quote_amount_in: u64, min_base_amount_burned: u64) -> Result<()> {
    let cfg = &ctx.accounts.global_config;
    require!(cfg.boost_enabled, AmmError::BoostDisabled);
    require!(cfg.disable_flags & DISABLE_BUY == 0, AmmError::Disabled);
    require_keys_eq!(ctx.accounts.authority.key(), cfg.boost_authority, AmmError::Unauthorized);
    require!(ctx.accounts.pool.virtual_quote_reserves > 0, AmmError::NothingToBoost);

    let vault_before = ctx.accounts.boost_vault.amount;
    let used = quote_amount_in.min(vault_before);
    require!(used > 0, AmmError::ZeroAmount);
    let base_reserve = ctx.accounts.pool_base_token_account.amount;
    let quote_reserve = effective_quote(&ctx.accounts.pool, &ctx.accounts.pool_quote_token_account)?;
    // what `used` quote buys at the effective price (no fees: the vault's quote is already the pool's)
    let burned = base_out_for_quote_in(used, base_reserve, quote_reserve)?;
    require!(burned > 0, AmmError::ZeroAmount);
    require!(burned >= min_base_amount_burned, AmmError::ExceededSlippage);
    require!(burned < base_reserve, AmmError::InsufficientLiquidity);

    let pool_key = ctx.accounts.pool.key();
    let vault_bump = [ctx.bumps.boost_vault_authority];
    let vault_seeds: &[&[u8]] = &[BOOST_VAULT_SEED, pool_key.as_ref(), &vault_bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.boost_vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.pool_quote_token_account.to_account_info(),
                authority: ctx.accounts.boost_vault_authority.to_account_info(),
            },
            &[vault_seeds],
        ),
        used,
        ctx.accounts.quote_mint.decimals,
    )?;
    let pool = &mut ctx.accounts.pool;
    let signer_seeds: &[&[&[u8]]] = &[pool_seeds!(pool)];
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.base_token_program.to_account_info(),
            Burn { mint: ctx.accounts.base_mint.to_account_info(), from: ctx.accounts.pool_base_token_account.to_account_info(), authority: pool.to_account_info() },
            signer_seeds,
        ),
        burned,
    )?;
    pool.virtual_quote_reserves = pool.virtual_quote_reserves.saturating_sub(used);
    ctx.accounts.boost_vault.reload()?;
    ctx.accounts.pool_base_token_account.reload()?;
    ctx.accounts.pool_quote_token_account.reload()?;
    let remaining = ctx.accounts.boost_vault.amount;
    emit_cpi!(BoostBuyAndBurnEvent {
        pool: pool_key,
        mint: ctx.accounts.pool.base_mint,
        authority: ctx.accounts.authority.key(),
        quote_amount_in_requested: quote_amount_in,
        quote_amount_in_used: used,
        base_amount_burned: burned,
        virtual_quote_reserves: ctx.accounts.pool.virtual_quote_reserves,
        real_quote_reserves_after: ctx.accounts.pool_quote_token_account.amount,
        base_reserves_after: ctx.accounts.pool_base_token_account.amount,
        boost_vault_remaining: remaining,
        timestamp: Clock::get()?.unix_timestamp,
    });
    if remaining == 0 {
        ctx.accounts.pool.virtual_quote_reserves = 0;
        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            token_interface::CloseAccount { account: ctx.accounts.boost_vault.to_account_info(), destination: ctx.accounts.authority.to_account_info(), authority: ctx.accounts.boost_vault_authority.to_account_info() },
            &[vault_seeds],
        ))?;
    }
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitBoost<'info> {
    #[account(mut, seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump, has_one = quote_mint, has_one = lp_mint, has_one = pool_quote_token_account)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    /// Pays the vault's rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub pool_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA owning the boost vault.
    #[account(seeds = [BOOST_VAULT_SEED, pool.key().as_ref()], bump)]
    pub boost_vault_authority: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = quote_mint, associated_token::authority = boost_vault_authority, associated_token::token_program = quote_token_program)]
    pub boost_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct BoostBuyAndBurn<'info> {
    #[account(mut, seeds = [POOL_SEED, &pool.index.to_le_bytes(), pool.creator.as_ref(), pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump, has_one = base_mint, has_one = quote_mint, has_one = pool_base_token_account, has_one = pool_quote_token_account)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub pool_base_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pool_quote_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: PDA owning the boost vault.
    #[account(seeds = [BOOST_VAULT_SEED, pool.key().as_ref()], bump)]
    pub boost_vault_authority: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = boost_vault_authority, associated_token::token_program = quote_token_program)]
    pub boost_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct InitBoostEvent { pub pool: Pubkey, pub mint: Pubkey, pub quote_mint: Pubkey, pub virtual_quote_reserves: u64, pub real_quote_reserves_after: u64, pub timestamp: i64 }
#[event]
pub struct BoostBuyAndBurnEvent {
    pub pool: Pubkey, pub mint: Pubkey, pub authority: Pubkey,
    pub quote_amount_in_requested: u64, pub quote_amount_in_used: u64, pub base_amount_burned: u64,
    pub virtual_quote_reserves: u64, pub real_quote_reserves_after: u64, pub base_reserves_after: u64, pub boost_vault_remaining: u64,
    pub timestamp: i64,
}
