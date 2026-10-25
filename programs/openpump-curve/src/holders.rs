//! Holder rewards. Same pattern pump.fun uses (recovered in lalalune/pumpfun-source
//! `create_v2.rs` / `holder_distribution.rs`): a holder-reward coin's *creator* is the PDA
//! `["holder-rewards", mint]`, so the regular trade path accrues the creator fee into that
//! PDA's creator vault with no special-casing. A configured distribution authority then pays
//! holders out of that vault with `distribute_fee_to_holders(amounts)`, passing the recipients
//! as remaining accounts (wallets for SOL curves; wallet + quote-ATA pairs for custom pairs).
//!
//! Trust model (identical to pump): the authority decides the split off-chain from a holder
//! snapshot. It can only move funds already earmarked for holders, never curve reserves.

use crate::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked};

pub const HOLDER_REWARDS_SEED: &[u8] = b"holder-rewards";
pub const MAX_RECIPIENTS: usize = 24;

pub fn holder_rewards_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[HOLDER_REWARDS_SEED, mint.as_ref()], &crate::ID).0
}

#[event]
pub struct DistributeFeeToHoldersEvent {
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub recipients: u64,
    pub total: u64,
    pub timestamp: i64,
}

#[event]
pub struct HolderRewardConfigEvent {
    pub enabled: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}

pub fn update_holder_reward_config(ctx: Context<AuthorityOnly>, enabled: bool, authority: Pubkey) -> Result<()> {
    let g = &mut ctx.accounts.global;
    g.holder_reward_enabled = enabled;
    g.holder_reward_authority = authority;
    emit_cpi!(HolderRewardConfigEvent { enabled, authority, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

/// Native-SOL curves: pay `amounts[i]` lamports to remaining_accounts[i].
pub fn distribute_fee_to_holders<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeFeeToHolders<'info>>, amounts: Vec<u64>) -> Result<()> {
    let bc = &ctx.accounts.bonding_curve;
    require!(bc.is_holder_reward, CurveError::NotHolderRewardCoin);
    require!(bc.quote_mint == Pubkey::default(), CurveError::WrongQuoteMint);
    require!(!amounts.is_empty() && amounts.len() <= MAX_RECIPIENTS, CurveError::HolderRecipientsMismatch);
    require!(ctx.remaining_accounts.len() == amounts.len(), CurveError::HolderRecipientsMismatch);

    let vault = ctx.accounts.creator_vault.to_account_info();
    let holder_key = ctx.accounts.holder_rewards.key();
    let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, holder_key.as_ref(), &[ctx.bumps.creator_vault]];
    let rent_min = Rent::get()?.minimum_balance(0);
    let available = vault.lamports().saturating_sub(rent_min);
    let mut total = 0u64;
    for (amount, to) in amounts.iter().zip(ctx.remaining_accounts.iter()) {
        require!(!to.executable, CurveError::HolderRecipientsMismatch);
        if *amount == 0 {
            continue;
        }
        system_program::transfer(
            CpiContext::new_with_signer(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: vault.clone(), to: to.clone() }, &[seeds]),
            *amount,
        )?;
        total = total.checked_add(*amount).ok_or(CurveError::MathOverflow)?;
    }
    require!(total <= available, CurveError::InsufficientReserves);
    emit_cpi!(DistributeFeeToHoldersEvent { mint: bc.mint, quote_mint: Pubkey::default(), recipients: amounts.len() as u64, total, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

/// Custom-pair curves: remaining accounts are (wallet, quote ATA) pairs; missing ATAs are
/// created with the authority paying rent.
pub fn distribute_fee_to_holders_v2<'info>(ctx: Context<'_, '_, 'info, 'info, DistributeFeeToHoldersV2<'info>>, amounts: Vec<u64>) -> Result<()> {
    let bc = &ctx.accounts.bonding_curve;
    require!(bc.is_holder_reward, CurveError::NotHolderRewardCoin);
    require!(!amounts.is_empty() && amounts.len() <= MAX_RECIPIENTS, CurveError::HolderRecipientsMismatch);
    require!(ctx.remaining_accounts.len() == amounts.len() * 2, CurveError::HolderRecipientsMismatch);

    let holder_key = ctx.accounts.holder_rewards.key();
    let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, holder_key.as_ref(), &[ctx.bumps.creator_vault]];
    let dec = ctx.accounts.quote_mint.decimals;
    let quote_mint = ctx.accounts.quote_mint.key();
    let tp = ctx.accounts.quote_token_program.key();
    let mut total = 0u64;
    for (amount, pair) in amounts.iter().zip(ctx.remaining_accounts.chunks_exact(2)) {
        let (wallet, ata) = (&pair[0], &pair[1]);
        require!(!wallet.executable, CurveError::HolderRecipientsMismatch);
        let expected = associated_token::get_associated_token_address_with_program_id(wallet.key, &quote_mint, &tp);
        require_keys_eq!(ata.key(), expected, CurveError::HolderRecipientsMismatch);
        if *amount == 0 {
            continue;
        }
        if ata.data_is_empty() {
            invoke(
                &anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                    ctx.accounts.authority.key,
                    wallet.key,
                    &quote_mint,
                    &tp,
                ),
                &[
                    ctx.accounts.authority.to_account_info(),
                    ata.clone(),
                    wallet.clone(),
                    ctx.accounts.quote_mint.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                    ctx.accounts.quote_token_program.to_account_info(),
                    ctx.accounts.associated_token_program.to_account_info(),
                ],
            )?;
        }
        ti::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.creator_vault_quote.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ata.clone(),
                    authority: ctx.accounts.creator_vault.to_account_info(),
                },
                &[seeds],
            ),
            *amount,
            dec,
        )?;
        total = total.checked_add(*amount).ok_or(CurveError::MathOverflow)?;
    }
    emit_cpi!(DistributeFeeToHoldersEvent { mint: bc.mint, quote_mint, recipients: amounts.len() as u64, total, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct DistributeFeeToHolders<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump, has_one = holder_reward_authority @ CurveError::Unauthorized)]
    pub global: Box<Account<'info, Global>>,
    /// The configured distribution authority (signs and pays tx fees).
    #[account(mut)]
    pub holder_reward_authority: Signer<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    /// CHECK: the coin's "creator": PDA ["holder-rewards", mint]; must equal bonding_curve.creator.
    #[account(seeds = [HOLDER_REWARDS_SEED, mint.key().as_ref()], bump, constraint = holder_rewards.key() == bonding_curve.creator @ CurveError::NotHolderRewardCoin)]
    pub holder_rewards: UncheckedAccount<'info>,
    /// CHECK: creator vault of the holder-rewards PDA, where trades accrue the creator fee.
    #[account(mut, seeds = [CREATOR_VAULT_SEED, holder_rewards.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DistributeFeeToHoldersV2<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump, has_one = holder_reward_authority @ CurveError::Unauthorized)]
    pub global: Box<Account<'info, Global>>,
    #[account(mut)]
    pub holder_reward_authority: Signer<'info>,
    /// CHECK: same signer, aliased for the ATA-creation CPI payer.
    #[account(mut, address = holder_reward_authority.key())]
    pub authority: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = quote_mint @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    /// CHECK: PDA ["holder-rewards", mint]; must equal bonding_curve.creator.
    #[account(seeds = [HOLDER_REWARDS_SEED, mint.key().as_ref()], bump, constraint = holder_rewards.key() == bonding_curve.creator @ CurveError::NotHolderRewardCoin)]
    pub holder_rewards: UncheckedAccount<'info>,
    /// CHECK: creator vault PDA of the holder-rewards PDA (authority of the quote ATA below).
    #[account(seeds = [CREATOR_VAULT_SEED, holder_rewards.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = creator_vault, associated_token::token_program = quote_token_program)]
    pub creator_vault_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
