//! Creator-fee sharing payouts (the fees program owns the `SharingConfig`; the vault lives here).
//! Mirrors pump.fun's `distribute_creator_fees`: a coin whose creator is a SharingConfig PDA has
//! its creator fee accrued in that PDA's creator vault; anyone can trigger the split.
//!
//! Native rule (recovered from pump): payouts only happen when every recipient's share covers its
//! rent deficit, otherwise the call is a no-op (so dust never leaves a recipient un-rent-exempt).

use crate::*;
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked};
use openpump_fee_types::{ConfigStatus, SharingConfig, FEES_PROGRAM_ID, SHARING_CONFIG_SEED};

#[event]
pub struct DistributeCreatorFeesEvent {
    pub mint: Pubkey,
    pub sharing_config: Pubkey,
    pub distributed: u64,
    pub recipients: u64,
    pub quote_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SetCreatorEvent {
    pub mint: Pubkey,
    pub old_creator: Pubkey,
    pub new_creator: Pubkey,
    pub timestamp: i64,
}

pub fn set_creator(ctx: Context<SetCreator>, new_creator: Pubkey) -> Result<()> {
    require!(new_creator != Pubkey::default(), CurveError::InvalidParams);
    let bc = &mut ctx.accounts.bonding_curve;
    require!(!bc.is_holder_reward, CurveError::NotHolderRewardCoin);
    let old = bc.creator;
    bc.creator = new_creator;
    emit_cpi!(SetCreatorEvent { mint: bc.mint, old_creator: old, new_creator, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

fn amounts_for(cfg: &SharingConfig, available: u64) -> Vec<u64> {
    cfg.shareholders.iter().map(|s| ((available as u128) * (s.share_bps as u128) / 10_000) as u64).collect()
}

pub fn distribute_creator_fees<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeCreatorFees<'info>>) -> Result<()> {
    let cfg = &ctx.accounts.sharing_config;
    require!(cfg.status == ConfigStatus::Active, CurveError::SharingNotActive);
    require!(ctx.accounts.bonding_curve.quote_mint == Pubkey::default(), CurveError::WrongQuoteMint);
    let n = cfg.shareholders.len();
    require!(ctx.remaining_accounts.len() >= n, CurveError::HolderRecipientsMismatch);
    let rent = Rent::get()?;
    let vault = ctx.accounts.creator_vault.to_account_info();
    let available = vault.lamports().saturating_sub(rent.minimum_balance(0));
    let amounts = amounts_for(cfg, available);

    // eligibility: every share must cover its recipient's rent deficit
    let mut eligible = true;
    for (i, s) in cfg.shareholders.iter().enumerate() {
        let r = &ctx.remaining_accounts[i];
        require_keys_eq!(r.key(), s.address, CurveError::HolderRecipientsMismatch);
        require!(!r.executable, CurveError::HolderRecipientsMismatch);
        let deficit = rent.minimum_balance(r.data_len()).saturating_sub(r.lamports());
        if amounts[i] < deficit {
            eligible = false;
        }
    }
    if !eligible || available == 0 {
        return Ok(());
    }
    let sharing_key = cfg.key();
    let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, sharing_key.as_ref(), &[ctx.bumps.creator_vault]];
    let mut distributed = 0u64;
    for (i, amount) in amounts.iter().enumerate() {
        if *amount == 0 {
            continue;
        }
        system_program::transfer(
            CpiContext::new_with_signer(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: vault.clone(), to: ctx.remaining_accounts[i].clone() }, &[seeds]),
            *amount,
        )?;
        distributed = distributed.checked_add(*amount).ok_or(CurveError::MathOverflow)?;
    }
    emit_cpi!(DistributeCreatorFeesEvent { mint: ctx.accounts.mint.key(), sharing_config: sharing_key, distributed, recipients: n as u64, quote_mint: Pubkey::default(), timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

/// Custom pairs: remaining accounts are (wallet, quote ATA) pairs; missing ATAs are created if `initialize_ata`.
pub fn distribute_creator_fees_v2<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeCreatorFeesV2<'info>>, initialize_ata: bool) -> Result<()> {
    let cfg = &ctx.accounts.sharing_config;
    require!(cfg.status == ConfigStatus::Active, CurveError::SharingNotActive);
    let n = cfg.shareholders.len();
    require!(ctx.remaining_accounts.len() >= n * 2, CurveError::HolderRecipientsMismatch);
    let available = ctx.accounts.creator_vault_quote.amount;
    if available == 0 {
        return Ok(());
    }
    let amounts = amounts_for(cfg, available);
    let sharing_key = cfg.key();
    let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, sharing_key.as_ref(), &[ctx.bumps.creator_vault]];
    let quote_mint = ctx.accounts.quote_mint.key();
    let tp = ctx.accounts.quote_token_program.key();
    let dec = ctx.accounts.quote_mint.decimals;
    let mut distributed = 0u64;
    for (i, s) in cfg.shareholders.iter().enumerate() {
        let wallet = &ctx.remaining_accounts[i];
        let ata = &ctx.remaining_accounts[n + i];
        require_keys_eq!(wallet.key(), s.address, CurveError::HolderRecipientsMismatch);
        require_keys_eq!(ata.key(), associated_token::get_associated_token_address_with_program_id(wallet.key, &quote_mint, &tp), CurveError::HolderRecipientsMismatch);
        if amounts[i] == 0 {
            continue;
        }
        if ata.data_is_empty() {
            require!(initialize_ata, CurveError::HolderRecipientsMismatch);
            anchor_lang::solana_program::program::invoke(
                &anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(ctx.accounts.payer.key, wallet.key, &quote_mint, &tp),
                &[ctx.accounts.payer.to_account_info(), ata.clone(), wallet.clone(), ctx.accounts.quote_mint.to_account_info(), ctx.accounts.system_program.to_account_info(), ctx.accounts.quote_token_program.to_account_info(), ctx.accounts.associated_token_program.to_account_info()],
            )?;
        }
        ti::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked { from: ctx.accounts.creator_vault_quote.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ata.clone(), authority: ctx.accounts.creator_vault.to_account_info() },
                &[seeds],
            ),
            amounts[i],
            dec,
        )?;
        distributed = distributed.checked_add(amounts[i]).ok_or(CurveError::MathOverflow)?;
    }
    emit_cpi!(DistributeCreatorFeesEvent { mint: ctx.accounts.mint.key(), sharing_config: sharing_key, distributed, recipients: n as u64, quote_mint, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetCreator<'info> {
    /// The coin's current creator.
    pub creator: Signer<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = creator @ CurveError::Unauthorized)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DistributeCreatorFees<'info> {
    pub mint: Box<Account<'info, Mint>>,
    #[account(seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, constraint = bonding_curve.creator == sharing_config.key() @ CurveError::SharingMismatch)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(seeds = [SHARING_CONFIG_SEED, mint.key().as_ref()], bump = sharing_config.bump, seeds::program = FEES_PROGRAM_ID, has_one = mint @ CurveError::SharingMismatch)]
    pub sharing_config: Box<Account<'info, SharingConfig>>,
    /// CHECK: the sharing config's creator vault.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, sharing_config.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DistributeCreatorFeesV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = quote_mint @ CurveError::WrongQuoteMint, constraint = bonding_curve.creator == sharing_config.key() @ CurveError::SharingMismatch)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(seeds = [SHARING_CONFIG_SEED, mint.key().as_ref()], bump = sharing_config.bump, seeds::program = FEES_PROGRAM_ID, has_one = mint @ CurveError::SharingMismatch)]
    pub sharing_config: Box<Account<'info, SharingConfig>>,
    /// CHECK: the sharing config's creator vault PDA (authority of the quote ATA).
    #[account(seeds = [CREATOR_VAULT_SEED, sharing_config.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = creator_vault, associated_token::token_program = quote_token_program)]
    pub creator_vault_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
