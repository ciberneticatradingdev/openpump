//! Creator management (pump.fun parity): community takeover by the protocol, and per-coin
//! creator-fee configuration within an admin-set ceiling.
//!
//! * `admin_cto(is_holder_reward, creator_fee_bps, new_creator)`: the configured
//!   `admin_set_creator_authority` reassigns an abandoned coin's creator. Converting to holder
//!   rewards sweeps whatever the old vault holds into the holder-rewards vault so nothing is lost.
//! * `update_creator_fee_config(configurable, max_bps)`: protocol switch + ceiling.
//! * `set_creator_fee_bps(bps)`: the creator picks their own fee (0 = follow the schedule)
//!   when the protocol allows it and the coin was launched editable.
//! * `set_can_edit_creator_fee(false)`: creator locks it permanently.

use crate::*;

#[event]
pub struct AdminCtoEvent {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub old_creator: Pubkey,
    pub new_creator: Pubkey,
    pub is_holder_reward: bool,
    pub old_creator_fee_bps: u64,
    pub new_creator_fee_bps: u64,
    pub swept_to_holder_vault: u64,
    pub timestamp: i64,
}
#[event]
pub struct UpdateCreatorFeeConfigEvent { pub authority: Pubkey, pub creator_fee_configurable: bool, pub max_configurable_creator_fee_bps: u64, pub timestamp: i64 }
#[event]
pub struct SetCreatorFeeBpsEvent { pub mint: Pubkey, pub creator: Pubkey, pub creator_fee_bps: u64, pub can_edit_creator_fee: bool, pub timestamp: i64 }

pub fn admin_cto(ctx: Context<AdminCto>, is_holder_reward: bool, creator_fee_bps: Option<u64>, new_creator: Option<Pubkey>) -> Result<()> {
    let g = &ctx.accounts.global;
    let bc = &ctx.accounts.bonding_curve;
    require!(!bc.is_holder_reward, CurveError::HolderRewardCreatorImmutable);
    require!(is_holder_reward != new_creator.is_some(), CurveError::InvalidParams); // exactly one of the two
    if is_holder_reward {
        require!(g.holder_reward_enabled, CurveError::HolderRewardDisabled);
    }
    if let Some(bps) = creator_fee_bps {
        require!(bps <= g.max_configurable_creator_fee_bps, CurveError::FeeTooHigh);
    }
    let old = bc.creator;
    let mint = bc.mint;
    let target = if is_holder_reward { holder_rewards_pda(&mint) } else { new_creator.unwrap() };
    require!(target != Pubkey::default(), CurveError::InvalidParams);

    // sweep the old vault into the holder-rewards vault when converting
    let mut swept = 0u64;
    if is_holder_reward {
        let old_vault = ctx.accounts.old_creator_vault.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(0);
        let amount = old_vault.lamports().saturating_sub(rent_min);
        if amount > 0 {
            let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, old.as_ref(), &[ctx.bumps.old_creator_vault]];
            system_program::transfer(
                CpiContext::new_with_signer(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: old_vault.clone(), to: ctx.accounts.holder_creator_vault.to_account_info() }, &[seeds]),
                amount,
            )?;
            swept = amount;
        }
    }
    let bc = &mut ctx.accounts.bonding_curve;
    let old_fee = bc.creator_fee_bps;
    bc.creator = target;
    bc.is_holder_reward = is_holder_reward;
    if let Some(bps) = creator_fee_bps {
        bc.creator_fee_bps = bps;
    }
    if is_holder_reward {
        bc.can_edit_creator_fee = false;
    }
    emit_cpi!(AdminCtoEvent { authority: ctx.accounts.authority.key(), mint, old_creator: old, new_creator: target, is_holder_reward, old_creator_fee_bps: old_fee, new_creator_fee_bps: bc.creator_fee_bps, swept_to_holder_vault: swept, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn update_creator_fee_config(ctx: Context<AuthorityOnly>, creator_fee_configurable: bool, max_configurable_creator_fee_bps: u64) -> Result<()> {
    require!(max_configurable_creator_fee_bps <= MAX_FEE_BPS, CurveError::FeeTooHigh);
    let g = &mut ctx.accounts.global;
    g.creator_fee_configurable = creator_fee_configurable;
    g.max_configurable_creator_fee_bps = max_configurable_creator_fee_bps;
    emit_cpi!(UpdateCreatorFeeConfigEvent { authority: g.authority, creator_fee_configurable, max_configurable_creator_fee_bps, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn set_admin_set_creator_authority(ctx: Context<AuthorityOnly>, authority: Pubkey) -> Result<()> {
    ctx.accounts.global.admin_set_creator_authority = authority;
    Ok(())
}

/// Creator sets their own fee (bps of the quote leg; 0 = follow the tier/schedule). `lock` makes it final.
pub fn set_creator_fee_bps(ctx: Context<CreatorOnly>, creator_fee_bps: u64, lock: bool) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(g.creator_fee_configurable, CurveError::CreatorFeeNotConfigurable);
    require!(creator_fee_bps <= g.max_configurable_creator_fee_bps, CurveError::FeeTooHigh);
    let bc = &mut ctx.accounts.bonding_curve;
    require!(bc.can_edit_creator_fee, CurveError::CreatorFeeLocked);
    bc.creator_fee_bps = creator_fee_bps;
    if lock {
        bc.can_edit_creator_fee = false;
    }
    emit_cpi!(SetCreatorFeeBpsEvent { mint: bc.mint, creator: bc.creator, creator_fee_bps, can_edit_creator_fee: bc.can_edit_creator_fee, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminCto<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump, constraint = global.admin_set_creator_authority == authority.key() @ CurveError::Unauthorized)]
    pub global: Box<Account<'info, Global>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    /// CHECK: the current creator's vault (swept when converting to holder rewards).
    #[account(mut, seeds = [CREATOR_VAULT_SEED, bonding_curve.creator.as_ref()], bump)]
    pub old_creator_vault: UncheckedAccount<'info>,
    /// CHECK: ["holder-rewards", mint] PDA.
    #[account(seeds = [HOLDER_REWARDS_SEED, mint.key().as_ref()], bump)]
    pub holder_rewards: UncheckedAccount<'info>,
    /// CHECK: creator vault of the holder-rewards PDA.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, holder_rewards.key().as_ref()], bump)]
    pub holder_creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreatorOnly<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = creator @ CurveError::Unauthorized)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
}
