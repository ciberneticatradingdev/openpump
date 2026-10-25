//! Volume incentives (pump.fun's "token incentives"; cashback is deprecated upstream and not
//! implemented). Semantics follow the updater recovered in lalalune/pumpfun-source
//! `pump-amm/src/incentives.rs`:
//!
//! * `GlobalVolumeAccumulator` ["global_volume_accumulator"]: a campaign of up to 30 "days"
//!   (`seconds_in_a_day` each) starting at `start_time`; per day a token supply to hand out and
//!   the total SOL buy volume observed.
//! * `UserVolumeAccumulator` ["user_volume_accumulator", user]: the user's buy volume for the
//!   current day, tokens accrued from completed days, and claimed totals.
//! * Buys on native-SOL curves that pass both accumulators are tracked. When a user acts on a
//!   later day than their last update, the completed day's reward is accrued:
//!   `current_sol_volume * total_token_supply[day] / sol_volumes[day]`.
//! * `claim_token_incentives` runs the same update and transfers the unclaimed tokens from the
//!   global accumulator's ATA (funded by the admin) to the user.

use crate::*;
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked};

pub const GLOBAL_VOLUME_SEED: &[u8] = b"global_volume_accumulator";
pub const USER_VOLUME_SEED: &[u8] = b"user_volume_accumulator";
pub const DAYS: usize = 30;

#[account]
#[derive(InitSpace)]
pub struct GlobalVolumeAccumulator {
    pub start_time: i64,
    pub end_time: i64,
    pub seconds_in_a_day: i64,
    pub mint: Pubkey,
    pub total_token_supply: [u64; DAYS],
    pub sol_volumes: [u64; DAYS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserVolumeAccumulator {
    pub user: Pubkey,
    pub needs_claim: bool,
    pub total_unclaimed_tokens: u64,
    pub total_claimed_tokens: u64,
    pub current_sol_volume: u64,
    pub last_update_timestamp: i64,
    pub has_total_claimed_tokens: bool,
    pub bump: u8,
}

#[event]
pub struct InitUserVolumeAccumulatorEvent { pub payer: Pubkey, pub user: Pubkey, pub timestamp: i64 }
#[event]
pub struct CloseUserVolumeAccumulatorEvent { pub user: Pubkey, pub total_unclaimed_tokens: u64, pub total_claimed_tokens: u64, pub current_sol_volume: u64, pub timestamp: i64 }
#[event]
pub struct SyncUserVolumeAccumulatorEvent { pub user: Pubkey, pub total_claimed_tokens_before: u64, pub total_claimed_tokens_after: u64, pub timestamp: i64 }
#[event]
pub struct AdminUpdateTokenIncentivesEvent { pub start_time: i64, pub end_time: i64, pub day_number: u64, pub token_supply_per_day: u64, pub mint: Pubkey, pub seconds_in_a_day: i64, pub timestamp: i64 }
#[event]
pub struct ClaimTokenIncentivesEvent { pub user: Pubkey, pub mint: Pubkey, pub amount: u64, pub timestamp: i64, pub total_claimed_tokens: u64, pub current_sol_volume: u64 }

// ---------------------------------------------------------------- core updater (shared by buys and claims)

fn day_of(ts: i64, g: &GlobalVolumeAccumulator) -> Option<usize> {
    if g.seconds_in_a_day <= 0 || ts < g.start_time { return None; }
    usize::try_from((ts - g.start_time) / g.seconds_in_a_day).ok()
}

fn reset_before_start(g: &GlobalVolumeAccumulator, u: &mut UserVolumeAccumulator, now: i64) {
    if now < g.start_time && u.last_update_timestamp < g.start_time {
        u.total_claimed_tokens = 0;
        u.has_total_claimed_tokens = false;
    }
}

/// Accrue the reward of a completed day (if any) into `total_unclaimed_tokens`.
pub fn settle(g: &GlobalVolumeAccumulator, u: &mut UserVolumeAccumulator, now: i64) -> Result<()> {
    reset_before_start(g, u, now);
    let Some(today) = day_of(now, g) else { return Ok(()) };
    if let Some(previous) = day_of(u.last_update_timestamp, g) {
        let end_day = day_of(g.end_time, g).unwrap_or(0);
        if previous < today && previous <= end_day && previous < DAYS && g.sol_volumes[previous] > 0 && u.current_sol_volume > 0 {
            let reward = (u.current_sol_volume as u128)
                .checked_mul(g.total_token_supply[previous] as u128)
                .ok_or(CurveError::MathOverflow)?
                / g.sol_volumes[previous] as u128;
            u.total_unclaimed_tokens = u.total_unclaimed_tokens.checked_add(u64::try_from(reward).map_err(|_| CurveError::MathOverflow)?).ok_or(CurveError::MathOverflow)?;
            u.current_sol_volume = 0;
        }
    }
    if now <= g.end_time {
        u.last_update_timestamp = now;
        u.needs_claim = u.total_unclaimed_tokens > 0 || u.current_sol_volume > 0;
    }
    Ok(())
}

/// Called from buys: settle, then add today's SOL volume to the user and the global bucket.
pub fn track(g: &mut GlobalVolumeAccumulator, u: &mut UserVolumeAccumulator, now: i64, sol: u64) -> Result<()> {
    settle(g, u, now)?;
    if now < g.start_time || now > g.end_time { return Ok(()); }
    let Some(today) = day_of(now, g) else { return Ok(()) };
    if today >= DAYS { return Ok(()); }
    u.current_sol_volume = u.current_sol_volume.checked_add(sol).ok_or(CurveError::MathOverflow)?;
    g.sol_volumes[today] = g.sol_volumes[today].checked_add(sol).ok_or(CurveError::MathOverflow)?;
    u.last_update_timestamp = now;
    u.needs_claim = true;
    Ok(())
}

// ---------------------------------------------------------------- handlers

pub fn init_user_volume_accumulator(ctx: Context<InitUserVolumeAccumulator>) -> Result<()> {
    let u = &mut ctx.accounts.user_volume_accumulator;
    if u.user == Pubkey::default() {
        u.user = ctx.accounts.user.key();
        u.bump = ctx.bumps.user_volume_accumulator;
    }
    emit_cpi!(InitUserVolumeAccumulatorEvent { payer: ctx.accounts.payer.key(), user: ctx.accounts.user.key(), timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn close_user_volume_accumulator(ctx: Context<CloseUserVolumeAccumulator>) -> Result<()> {
    let u = &ctx.accounts.user_volume_accumulator;
    emit_cpi!(CloseUserVolumeAccumulatorEvent { user: ctx.accounts.user.key(), total_unclaimed_tokens: u.total_unclaimed_tokens, total_claimed_tokens: u.total_claimed_tokens, current_sol_volume: u.current_sol_volume, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn sync_user_volume_accumulator(ctx: Context<SyncUserVolumeAccumulator>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let before = ctx.accounts.user_volume_accumulator.total_claimed_tokens;
    reset_before_start(&ctx.accounts.global_volume_accumulator, &mut ctx.accounts.user_volume_accumulator, now);
    let after = ctx.accounts.user_volume_accumulator.total_claimed_tokens;
    if before != after {
        emit_cpi!(SyncUserVolumeAccumulatorEvent { user: ctx.accounts.user.key(), total_claimed_tokens_before: before, total_claimed_tokens_after: after, timestamp: now });
    }
    Ok(())
}

pub fn admin_update_token_incentives(ctx: Context<AdminUpdateTokenIncentives>, start_time: i64, end_time: i64, seconds_in_a_day: i64, day_number: u64, token_supply_per_day: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(seconds_in_a_day > 0, CurveError::InvalidParams);
    let g = &mut ctx.accounts.global_volume_accumulator;
    if g.bump == 0 { g.bump = ctx.bumps.global_volume_accumulator; }
    g.mint = ctx.accounts.mint.key();
    g.seconds_in_a_day = seconds_in_a_day;
    if start_time != 0 && end_time != 0 {
        if start_time != g.start_time {
            require!(start_time > now, CurveError::IncentiveTime);
            g.start_time = start_time;
            g.total_token_supply = [0; DAYS];
            g.sol_volumes = [0; DAYS];
        }
        require!(end_time > now && end_time > start_time, CurveError::IncentiveTime);
        require!(end_time - start_time < seconds_in_a_day * DAYS as i64, CurveError::IncentiveTime);
        g.end_time = end_time;
        if now > g.start_time {
            let current = ((now - g.start_time) / seconds_in_a_day) as usize;
            let end = ((g.end_time - g.start_time) / seconds_in_a_day) as usize;
            require!(end > current, CurveError::IncentiveTime);
            for i in current + 1..=end.min(DAYS - 1) { g.sol_volumes[i] = 0; }
        }
    }
    if token_supply_per_day > 0 {
        require!(now <= g.end_time, CurveError::IncentiveTime);
        let current = if now < g.start_time { 0 } else { ((now - g.start_time) / seconds_in_a_day) as usize };
        let end = (((g.end_time - g.start_time) / seconds_in_a_day) as usize).min(DAYS - 1);
        if day_number < DAYS as u64 {
            let d = day_number as usize;
            require!(d <= end && d >= current, CurveError::IncentiveTime);
            g.total_token_supply[d] = token_supply_per_day;
        } else {
            for i in current..=end { g.total_token_supply[i] = token_supply_per_day; }
        }
    }
    emit_cpi!(AdminUpdateTokenIncentivesEvent { start_time, end_time, day_number, token_supply_per_day, mint: g.mint, seconds_in_a_day, timestamp: now });
    Ok(())
}

pub fn claim_token_incentives(ctx: Context<ClaimTokenIncentives>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let g = &ctx.accounts.global_volume_accumulator;
    let u = &mut ctx.accounts.user_volume_accumulator;
    settle(g, u, now)?;
    let amount = u.total_unclaimed_tokens;
    if amount == 0 {
        msg!("No tokens to claim");
        return Ok(());
    }
    let seeds: &[&[u8]] = &[GLOBAL_VOLUME_SEED, &[g.bump]];
    ti::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked { from: ctx.accounts.global_incentive_token_account.to_account_info(), mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.user_ata.to_account_info(), authority: g.to_account_info() },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    u.total_unclaimed_tokens = 0;
    u.total_claimed_tokens = u.total_claimed_tokens.checked_add(amount).ok_or(CurveError::MathOverflow)?;
    u.has_total_claimed_tokens = true;
    u.needs_claim = u.current_sol_volume > 0;
    u.last_update_timestamp = now;
    emit_cpi!(ClaimTokenIncentivesEvent { user: ctx.accounts.user.key(), mint: g.mint, amount, timestamp: now, total_claimed_tokens: u.total_claimed_tokens, current_sol_volume: u.current_sol_volume });
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct InitUserVolumeAccumulator<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: any wallet may be funded by the payer.
    pub user: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + UserVolumeAccumulator::INIT_SPACE, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump)]
    pub user_volume_accumulator: Account<'info, UserVolumeAccumulator>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CloseUserVolumeAccumulator<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, close = user, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump = user_volume_accumulator.bump)]
    pub user_volume_accumulator: Account<'info, UserVolumeAccumulator>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SyncUserVolumeAccumulator<'info> {
    /// CHECK: PDA seed only.
    pub user: UncheckedAccount<'info>,
    #[account(seeds = [GLOBAL_VOLUME_SEED], bump = global_volume_accumulator.bump)]
    pub global_volume_accumulator: Box<Account<'info, GlobalVolumeAccumulator>>,
    #[account(mut, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump = user_volume_accumulator.bump)]
    pub user_volume_accumulator: Account<'info, UserVolumeAccumulator>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminUpdateTokenIncentives<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump, has_one = authority @ CurveError::Unauthorized)]
    pub global: Box<Account<'info, Global>>,
    #[account(init_if_needed, payer = authority, space = 8 + GlobalVolumeAccumulator::INIT_SPACE, seeds = [GLOBAL_VOLUME_SEED], bump)]
    pub global_volume_accumulator: Box<Account<'info, GlobalVolumeAccumulator>>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = global_volume_accumulator, associated_token::token_program = token_program)]
    pub global_incentive_token_account: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimTokenIncentives<'info> {
    /// CHECK: destination authority and PDA seed; anyone may pay to claim for a user.
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [GLOBAL_VOLUME_SEED], bump = global_volume_accumulator.bump, has_one = mint @ CurveError::InvalidParams)]
    pub global_volume_accumulator: Box<Account<'info, GlobalVolumeAccumulator>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = global_volume_accumulator, associated_token::token_program = token_program)]
    pub global_incentive_token_account: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(mut, seeds = [USER_VOLUME_SEED, user.key().as_ref()], bump = user_volume_accumulator.bump)]
    pub user_volume_accumulator: Box<Account<'info, UserVolumeAccumulator>>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = user, associated_token::token_program = token_program)]
    pub user_ata: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
