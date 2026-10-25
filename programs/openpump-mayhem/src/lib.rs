//! OpenPump Mayhem (pump.fun "Mayhem mode" parity, recovered from lalalune/pumpfun-source
//! `programs/mayhem`): a protocol-operated market-making vault. Coins launched in mayhem mode
//! get a `MayhemState` with a deadline; the configured `trader` buys and sells them on the curve
//! from the shared `sol-vault` PDA inside a reference-price tolerance and a per-sweep SOL cap.
//! When the deadline passes, the vault's remaining tokens are burned. Admin withdraws SOL / tokens
//! and sweeps realised profits to the fee recipient.
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self as ti, Burn, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface};
use openpump_curve::program::OpenpumpCurve;

declare_id!("Bh6Tz6WwwQbxEAMB2FjkrLWjAXbAxDn3t445jU1pZMAP");

pub const INITIAL_ADMIN: Pubkey = pubkey!("J37KbWUsm9NrVMQjS7b1UtrnxhrLjbot2m8R8REfz3jE");
pub const GLOBAL_PARAMS_SEED: &[u8] = b"global-params";
pub const SOL_VAULT_SEED: &[u8] = b"sol-vault";
pub const MAYHEM_STATE_SEED: &[u8] = b"mayhem-state";
pub const BPS: u128 = 10_000;
/// Price scale for `reference`: lamports per whole token × 1e9.
pub const PRICE_SCALE: u128 = 1_000_000_000;

pub fn sol_vault() -> Pubkey {
    Pubkey::find_program_address(&[SOL_VAULT_SEED], &ID).0
}

#[account]
#[derive(InitSpace)]
pub struct GlobalParams {
    pub bump: u8,
    pub admin: Pubkey,
    pub trader: Pubkey,
    pub fee_recipient: Pubkey,
    pub paused: bool,
    /// Net SOL currently deployed across all mayhem coins (lamports, signed so sells can overshoot).
    pub sol_deployed: i128,
    pub max_sol_per_sweep: u64,
    pub mayhem_duration_seconds: i64,
    pub version: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MayhemStatus {
    Active,
    Ended,
}

#[account]
#[derive(InitSpace)]
pub struct MayhemState {
    pub bump: u8,
    pub mint: Pubkey,
    pub end_timestamp: i64,
    pub sol_deployed: i128,
    pub token_net: i128,
    pub status: MayhemStatus,
    pub burned_amount: u64,
}

#[program]
pub mod openpump_mayhem {
    use super::*;

    pub fn initialize_global_params(ctx: Context<InitializeGlobalParams>, trader: Pubkey, fee_recipient: Pubkey, max_sol_per_sweep: u64, mayhem_duration_seconds: i64) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), INITIAL_ADMIN, MayhemError::Unauthorized);
        let g = &mut ctx.accounts.global_params;
        g.bump = ctx.bumps.global_params;
        g.admin = ctx.accounts.admin.key();
        g.trader = trader;
        g.fee_recipient = fee_recipient;
        g.paused = false;
        g.sol_deployed = 0;
        g.max_sol_per_sweep = max_sol_per_sweep;
        g.mayhem_duration_seconds = mayhem_duration_seconds;
        g.version = 1;
        Ok(())
    }
    pub fn update_admin(ctx: Context<Admin>, new_admin: Pubkey) -> Result<()> { bump(&mut ctx.accounts.global_params); ctx.accounts.global_params.admin = new_admin; Ok(()) }
    pub fn update_trader(ctx: Context<Admin>, new_trader: Pubkey) -> Result<()> { bump(&mut ctx.accounts.global_params); ctx.accounts.global_params.trader = new_trader; Ok(()) }
    pub fn update_max_sol_per_sweep(ctx: Context<Admin>, value: u64) -> Result<()> { bump(&mut ctx.accounts.global_params); ctx.accounts.global_params.max_sol_per_sweep = value; Ok(()) }
    pub fn update_global_params(ctx: Context<Admin>, mayhem_duration_seconds: Option<i64>, fee_recipient: Option<Pubkey>) -> Result<()> {
        let g = &mut ctx.accounts.global_params;
        bump(g);
        if let Some(d) = mayhem_duration_seconds { require!(d > 0, MayhemError::InvalidParams); g.mayhem_duration_seconds = d; }
        if let Some(f) = fee_recipient { g.fee_recipient = f; }
        emit_cpi!(GlobalParamsUpdateEvent { admin: g.admin, trader: g.trader, max_sol_per_sweep: g.max_sol_per_sweep, mayhem_duration_seconds: g.mayhem_duration_seconds, version: g.version, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }
    pub fn reset_sol_deployed(ctx: Context<Admin>) -> Result<()> { bump(&mut ctx.accounts.global_params); ctx.accounts.global_params.sol_deployed = 0; Ok(()) }
    pub fn stop_trading(ctx: Context<Admin>) -> Result<()> { ctx.accounts.global_params.paused = true; Ok(()) }
    pub fn resume_trading(ctx: Context<Admin>) -> Result<()> { ctx.accounts.global_params.paused = false; Ok(()) }

    /// Register a mayhem-mode coin (its curve must carry `is_mayhem_mode`). Called right after launch.
    pub fn init_state(ctx: Context<InitState>) -> Result<()> {
        require!(ctx.accounts.bonding_curve.is_mayhem_mode, MayhemError::NotMayhemCoin);
        let s = &mut ctx.accounts.mayhem_state;
        if s.mint != Pubkey::default() {
            return Ok(());
        }
        s.bump = ctx.bumps.mayhem_state;
        s.mint = ctx.accounts.mint.key();
        s.end_timestamp = Clock::get()?.unix_timestamp + ctx.accounts.global_params.mayhem_duration_seconds;
        s.status = MayhemStatus::Active;
        emit_cpi!(MayhemStateInitEvent { mint: s.mint, end_timestamp: s.end_timestamp, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Trader buys `sol_amount` of the coin from the vault, only if the curve's spot price is within
    /// `tolerance_bps` of `reference` (lamports/token × 1e9) and the amount is under the sweep cap.
    pub fn buy<'info>(ctx: Context<'_, '_, '_, 'info, Trade<'info>>, sol_amount: u64, reference: u128, tolerance_bps: u16) -> Result<()> {
        let g = &ctx.accounts.global_params;
        require!(!g.paused, MayhemError::TradingPaused);
        require!(ctx.accounts.mayhem_state.status == MayhemStatus::Active, MayhemError::MayhemEnded);
        require!(Clock::get()?.unix_timestamp < ctx.accounts.mayhem_state.end_timestamp, MayhemError::MayhemEnded);
        require!(sol_amount > 0 && sol_amount <= g.max_sol_per_sweep, MayhemError::SweepCapExceeded);
        check_price(&ctx.accounts.bonding_curve, reference, tolerance_bps)?;
        let before = ctx.accounts.sol_vault.lamports();
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        openpump_curve::cpi::buy_exact_sol_in(curve_ctx(&ctx, &[seeds]), sol_amount, 0)?;
        let spent = before.saturating_sub(ctx.accounts.sol_vault.lamports());
        let s = &mut ctx.accounts.mayhem_state;
        s.sol_deployed = s.sol_deployed.checked_add(spent as i128).ok_or(MayhemError::MathOverflow)?;
        let g = &mut ctx.accounts.global_params;
        g.sol_deployed = g.sol_deployed.checked_add(spent as i128).ok_or(MayhemError::MathOverflow)?;
        emit_cpi!(MayhemTradeEvent { side: 0, mint: s.mint, sol_amount: spent, reference, tolerance_bps, sol_vault_balance: ctx.accounts.sol_vault.lamports(), state_sol_deployed: s.sol_deployed, global_sol_deployed: g.sol_deployed, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Trader sells `token_amount` from the vault within the price tolerance. `retained_reserve_bps`
    /// caps the SOL taken out at that share of the curve's real reserves (never drains a curve).
    pub fn sell<'info>(ctx: Context<'_, '_, '_, 'info, Trade<'info>>, token_amount: u64, reference: u128, tolerance_bps: u16, retained_reserve_bps: u16) -> Result<()> {
        let g = &ctx.accounts.global_params;
        require!(!g.paused, MayhemError::TradingPaused);
        require!(token_amount > 0, MayhemError::InvalidParams);
        require!(retained_reserve_bps as u128 <= BPS, MayhemError::InvalidParams);
        check_price(&ctx.accounts.bonding_curve, reference, tolerance_bps)?;
        let bc = &ctx.accounts.bonding_curve;
        let max_out = (bc.real_sol_reserves as u128) * (BPS - retained_reserve_bps as u128) / BPS;
        let sol_out = openpump_curve::math::sol_out_for_tokens_in(token_amount, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
        require!((sol_out as u128) <= max_out, MayhemError::RetainedReserve);
        let before = ctx.accounts.sol_vault.lamports();
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        openpump_curve::cpi::sell(curve_ctx(&ctx, &[seeds]), token_amount, 0)?;
        let received = ctx.accounts.sol_vault.lamports().saturating_sub(before);
        let s = &mut ctx.accounts.mayhem_state;
        s.sol_deployed = s.sol_deployed.checked_sub(received as i128).ok_or(MayhemError::MathOverflow)?;
        let g = &mut ctx.accounts.global_params;
        g.sol_deployed = g.sol_deployed.checked_sub(received as i128).ok_or(MayhemError::MathOverflow)?;
        emit_cpi!(MayhemTradeEvent { side: 1, mint: s.mint, sol_amount: received, reference, tolerance_bps, sol_vault_balance: ctx.accounts.sol_vault.lamports(), state_sol_deployed: s.sol_deployed, global_sol_deployed: g.sol_deployed, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// After the deadline anyone can burn what the vault still holds of the coin.
    pub fn burn_tokens(ctx: Context<BurnTokens>) -> Result<()> {
        let s = &ctx.accounts.mayhem_state;
        require!(s.end_timestamp <= Clock::get()?.unix_timestamp, MayhemError::MayhemNotEnded);
        require!(s.status != MayhemStatus::Ended, MayhemError::MayhemEnded);
        let amount = ctx.accounts.mayhem_token_vault.amount;
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        if amount > 0 {
            ti::burn(
                CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Burn { mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.mayhem_token_vault.to_account_info(), authority: ctx.accounts.sol_vault.to_account_info() }, &[seeds]),
                amount,
            )?;
        }
        let s = &mut ctx.accounts.mayhem_state;
        s.burned_amount = amount;
        s.status = MayhemStatus::Ended;
        emit_cpi!(BurnEvent { mint: s.mint, amount, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Admin takes SOL out of the vault.
    pub fn withdraw_admin(ctx: Context<WithdrawAdmin>, amount: u64) -> Result<()> {
        let rent = Rent::get()?.minimum_balance(0);
        require!(ctx.accounts.sol_vault.lamports().saturating_sub(rent) >= amount, MayhemError::InsufficientVault);
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        system_program::transfer(CpiContext::new_with_signer(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.sol_vault.to_account_info(), to: ctx.accounts.admin.to_account_info() }, &[seeds]), amount)?;
        emit_cpi!(SweepEvent { amount, to: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Admin takes a token out of the vault (e.g. unsold coin after a campaign).
    pub fn withdraw_quote_admin(ctx: Context<WithdrawQuoteAdmin>, amount: u64) -> Result<()> {
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        ti::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), ti::TransferChecked { from: ctx.accounts.vault_token_account.to_account_info(), mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.admin_token_account.to_account_info(), authority: ctx.accounts.sol_vault.to_account_info() }, &[seeds]),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    /// Realised profit (vault SOL above what is still deployed + rent) goes to the fee recipient.
    pub fn sweep_fees(ctx: Context<SweepFees>) -> Result<()> {
        let g = &ctx.accounts.global_params;
        let rent = Rent::get()?.minimum_balance(0);
        let deployed = g.sol_deployed.max(0) as u128;
        let bal = ctx.accounts.sol_vault.lamports() as u128;
        let profit = bal.saturating_sub(deployed + rent as u128) as u64;
        require!(profit > 0, MayhemError::NothingToSweep);
        let seeds: &[&[u8]] = &[SOL_VAULT_SEED, &[ctx.bumps.sol_vault]];
        system_program::transfer(CpiContext::new_with_signer(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.sol_vault.to_account_info(), to: ctx.accounts.fee_recipient.to_account_info() }, &[seeds]), profit)?;
        emit_cpi!(SweepEvent { amount: profit, to: ctx.accounts.fee_recipient.key(), timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }
}

fn bump(g: &mut GlobalParams) {
    g.version = g.version.wrapping_add(1);
}

/// Spot price = vS / vT (lamports per whole token × 1e9) must sit inside reference ± tolerance.
fn check_price(bc: &openpump_curve::BondingCurve, reference: u128, tolerance_bps: u16) -> Result<()> {
    require!(reference > 0 && (tolerance_bps as u128) <= BPS, MayhemError::InvalidParams);
    let spot = (bc.virtual_sol_reserves as u128) * PRICE_SCALE * 1_000_000 / (bc.virtual_token_reserves as u128).max(1);
    let delta = reference * tolerance_bps as u128 / BPS;
    require!(spot >= reference.saturating_sub(delta) && spot <= reference.saturating_add(delta), MayhemError::PriceOutOfRange);
    Ok(())
}

fn curve_ctx<'a, 'info>(ctx: &'a Context<'_, '_, '_, 'info, Trade<'info>>, signer: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, openpump_curve::cpi::accounts::Trade<'info>> {
    let a = &ctx.accounts;
    CpiContext::new_with_signer(
        a.curve_program.to_account_info(),
        openpump_curve::cpi::accounts::Trade {
            global: a.global.to_account_info(),
            fee_recipient: a.fee_recipient.to_account_info(),
            mint: a.mint.to_account_info(),
            bonding_curve: a.bonding_curve.to_account_info(),
            associated_bonding_curve: a.associated_bonding_curve.to_account_info(),
            associated_user: a.mayhem_token_vault.to_account_info(),
            user: a.sol_vault.to_account_info(),
            creator_vault: a.creator_vault.to_account_info(),
            system_program: a.system_program.to_account_info(),
            token_program: a.token_program.to_account_info(),
            associated_token_program: a.associated_token_program.to_account_info(),
            global_volume_accumulator: None,
            user_volume_accumulator: None,
            fee_config: a.fee_config.as_ref().map(|x| x.to_account_info()),
            buyback_fee_recipient: a.buyback_fee_recipient.as_ref().map(|x| x.to_account_info()),
            event_authority: a.curve_event_authority.to_account_info(),
            program: a.curve_program.to_account_info(),
        },
        signer,
    )
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeGlobalParams<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + GlobalParams::INIT_SPACE, seeds = [GLOBAL_PARAMS_SEED], bump)]
    pub global_params: Account<'info, GlobalParams>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Admin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump, has_one = admin @ MayhemError::Unauthorized)]
    pub global_params: Account<'info, GlobalParams>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitState<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump)]
    pub global_params: Box<Account<'info, GlobalParams>>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(seeds = [openpump_curve::BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, seeds::program = openpump_curve::ID, has_one = mint)]
    pub bonding_curve: Box<Account<'info, openpump_curve::BondingCurve>>,
    #[account(init_if_needed, payer = payer, space = 8 + MayhemState::INIT_SPACE, seeds = [MAYHEM_STATE_SEED, mint.key().as_ref()], bump)]
    pub mayhem_state: Box<Account<'info, MayhemState>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump, has_one = trader @ MayhemError::Unauthorized)]
    pub global_params: Box<Account<'info, GlobalParams>>,
    #[account(mut, seeds = [MAYHEM_STATE_SEED, mint.key().as_ref()], bump = mayhem_state.bump, has_one = mint)]
    pub mayhem_state: Box<Account<'info, MayhemState>>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    /// CHECK: the vault PDA; pays / receives SOL as the curve's `user` under program signature.
    #[account(mut, seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = trader, associated_token::mint = mint, associated_token::authority = sol_vault, associated_token::token_program = token_program)]
    pub mayhem_token_vault: Box<InterfaceAccount<'info, TokenAccountI>>,
    // ---- curve accounts (validated by the curve during CPI)
    pub curve_program: Program<'info, OpenpumpCurve>,
    /// CHECK: curve Global.
    pub global: UncheckedAccount<'info>,
    /// CHECK: curve fee recipient.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(mut, seeds = [openpump_curve::BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, seeds::program = openpump_curve::ID, has_one = mint)]
    pub bonding_curve: Box<Account<'info, openpump_curve::BondingCurve>>,
    /// CHECK: curve token vault (ATA of the bonding curve).
    #[account(mut)]
    pub associated_bonding_curve: UncheckedAccount<'info>,
    /// CHECK: creator vault PDA.
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,
    /// CHECK: optional fees-program config.
    pub fee_config: Option<UncheckedAccount<'info>>,
    /// CHECK: optional buyback vault.
    #[account(mut)]
    pub buyback_fee_recipient: Option<UncheckedAccount<'info>>,
    /// CHECK: curve event authority.
    pub curve_event_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut, seeds = [MAYHEM_STATE_SEED, mint.key().as_ref()], bump = mayhem_state.bump, has_one = mint)]
    pub mayhem_state: Box<Account<'info, MayhemState>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = sol_vault, associated_token::token_program = token_program)]
    pub mayhem_token_vault: Box<InterfaceAccount<'info, TokenAccountI>>,
    /// CHECK: vault PDA (token authority).
    #[account(seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump, has_one = admin @ MayhemError::Unauthorized)]
    pub global_params: Box<Account<'info, GlobalParams>>,
    /// CHECK: vault PDA.
    #[account(mut, seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawQuoteAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump, has_one = admin @ MayhemError::Unauthorized)]
    pub global_params: Box<Account<'info, GlobalParams>>,
    /// CHECK: vault PDA.
    #[account(seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = sol_vault, associated_token::token_program = token_program)]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(init_if_needed, payer = admin, associated_token::mint = mint, associated_token::authority = admin, associated_token::token_program = token_program)]
    pub admin_token_account: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SweepFees<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [GLOBAL_PARAMS_SEED], bump = global_params.bump, has_one = fee_recipient @ MayhemError::Unauthorized)]
    pub global_params: Box<Account<'info, GlobalParams>>,
    /// CHECK: vault PDA.
    #[account(mut, seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: matched against GlobalParams.fee_recipient.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------- events / errors

#[event]
pub struct GlobalParamsUpdateEvent { pub admin: Pubkey, pub trader: Pubkey, pub max_sol_per_sweep: u64, pub mayhem_duration_seconds: i64, pub version: u32, pub timestamp: i64 }
#[event]
pub struct MayhemStateInitEvent { pub mint: Pubkey, pub end_timestamp: i64, pub timestamp: i64 }
#[event]
pub struct MayhemTradeEvent { pub side: u8, pub mint: Pubkey, pub sol_amount: u64, pub reference: u128, pub tolerance_bps: u16, pub sol_vault_balance: u64, pub state_sol_deployed: i128, pub global_sol_deployed: i128, pub timestamp: i64 }
#[event]
pub struct BurnEvent { pub mint: Pubkey, pub amount: u64, pub timestamp: i64 }
#[event]
pub struct SweepEvent { pub amount: u64, pub to: Pubkey, pub timestamp: i64 }

#[error_code]
pub enum MayhemError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Trading is paused")]
    TradingPaused,
    #[msg("Not a mayhem-mode coin")]
    NotMayhemCoin,
    #[msg("Mayhem period has ended")]
    MayhemEnded,
    #[msg("Mayhem period has not ended")]
    MayhemNotEnded,
    #[msg("Sweep cap exceeded")]
    SweepCapExceeded,
    #[msg("Spot price outside the reference tolerance")]
    PriceOutOfRange,
    #[msg("Sell would take more than the retained reserve allows")]
    RetainedReserve,
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient vault balance")]
    InsufficientVault,
    #[msg("Nothing to sweep")]
    NothingToSweep,
}
