//! OpenPump fees program (clean-room, shaped like pump.fun's `pump_fees`):
//!   * FeeProgramGlobal: authority, feature flags, social-claim authority, claim rate limit
//!   * FeeConfig: flat fees + market-cap tiers (SOL / stable / exotic) read by the curve and AMM
//!   * SharingConfig per coin: split the creator fee between up to 10 wallets
//!   * SocialFeePda: fees earned by a social identity (e.g. an X account) before it has a wallet
//!   * DonationFeePda: route a coin's creator fee to a beneficiary wallet
//!   * BuybackVault: where the protocol's buyback share accrues; swept by its authority
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked};
pub use openpump_fee_types::*;

declare_id!("goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5");

pub const INITIAL_AUTHORITY: Pubkey = pubkey!("J37KbWUsm9NrVMQjS7b1UtrnxhrLjbot2m8R8REfz3jE");
pub const MAX_TOTAL_FEE_BPS: u64 = 1_000;
pub const MAX_USER_ID: usize = 32;

pub const FLAG_SOCIAL_CREATE: u8 = 1;
pub const FLAG_SOCIAL_CLAIM: u8 = 2;
pub const FLAG_DONATION_CREATE: u8 = 4;
pub const FLAG_DONATION_CRANK: u8 = 8;
pub const FLAG_SHARING: u8 = 16;

#[program]
pub mod openpump_fees {
    use super::*;

    // ------------------------------------------------------------ global

    pub fn initialize_fee_program_global(ctx: Context<InitializeFeeProgramGlobal>, social_claim_authority: Pubkey, disable_flags: u8, claim_rate_limit: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.authority.key(), INITIAL_AUTHORITY, FeeError::NotAuthorized);
        let g = &mut ctx.accounts.fee_program_global;
        g.bump = ctx.bumps.fee_program_global;
        g.authority = ctx.accounts.authority.key();
        g.social_claim_authority = social_claim_authority;
        g.disable_flags = disable_flags;
        g.claim_rate_limit = claim_rate_limit;
        emit_cpi!(InitializeFeeProgramGlobalEvent { timestamp: now()?, authority: g.authority, social_claim_authority, disable_flags, claim_rate_limit });
        Ok(())
    }
    pub fn set_authority(ctx: Context<GlobalAdmin>, new_authority: Pubkey) -> Result<()> {
        let old = ctx.accounts.fee_program_global.authority;
        ctx.accounts.fee_program_global.authority = new_authority;
        emit_cpi!(SetAuthorityEvent { timestamp: now()?, old_authority: old, new_authority });
        Ok(())
    }
    pub fn set_social_claim_authority(ctx: Context<GlobalAdmin>, social_claim_authority: Pubkey) -> Result<()> {
        ctx.accounts.fee_program_global.social_claim_authority = social_claim_authority;
        emit_cpi!(SetSocialClaimAuthorityEvent { timestamp: now()?, social_claim_authority });
        Ok(())
    }
    pub fn set_disable_flags(ctx: Context<GlobalAdmin>, disable_flags: u8) -> Result<()> {
        ctx.accounts.fee_program_global.disable_flags = disable_flags;
        emit_cpi!(SetDisableFlagsEvent { timestamp: now()?, disable_flags });
        Ok(())
    }
    pub fn set_claim_rate_limit(ctx: Context<GlobalAdmin>, claim_rate_limit: u64) -> Result<()> {
        ctx.accounts.fee_program_global.claim_rate_limit = claim_rate_limit;
        emit_cpi!(SetClaimRateLimitEvent { timestamp: now()?, claim_rate_limit });
        Ok(())
    }

    // ------------------------------------------------------------ fee config (tiers)

    pub fn initialize_fee_config(ctx: Context<InitializeFeeConfig>, flat_fees: Fees, fee_tiers: Vec<FeeTier>) -> Result<()> {
        validate_fees(&flat_fees)?;
        validate_tiers(&fee_tiers)?;
        let c = &mut ctx.accounts.fee_config;
        c.bump = ctx.bumps.fee_config;
        c.admin = ctx.accounts.authority.key();
        c.flat_fees = flat_fees;
        c.fee_tiers = fee_tiers.clone();
        emit_cpi!(UpdateFeeConfigEvent { timestamp: now()?, admin: c.admin, fee_config: c.key(), flat_fees, fee_tiers });
        Ok(())
    }
    pub fn update_fee_config(ctx: Context<FeeConfigAdmin>, fee_tiers: Vec<FeeTier>, flat_fees: Fees) -> Result<()> {
        validate_fees(&flat_fees)?;
        validate_tiers(&fee_tiers)?;
        let c = &mut ctx.accounts.fee_config;
        c.flat_fees = flat_fees;
        c.fee_tiers = fee_tiers.clone();
        emit_cpi!(UpdateFeeConfigEvent { timestamp: now()?, admin: c.admin, fee_config: c.key(), flat_fees, fee_tiers });
        Ok(())
    }
    pub fn update_stable_fee_config(ctx: Context<FeeConfigAdmin>, fee_tiers: Vec<FeeTier>, stable_mints: Vec<Pubkey>) -> Result<()> {
        validate_tiers(&fee_tiers)?;
        require!(stable_mints.len() <= MAX_STABLE_MINTS, FeeError::TooManyTiers);
        let c = &mut ctx.accounts.fee_config;
        c.stable_fee_tiers = fee_tiers.clone();
        c.stable_mints = stable_mints;
        emit_cpi!(UpdateStableFeeConfigEvent { timestamp: now()?, admin: c.admin, fee_config: c.key(), fee_tiers });
        Ok(())
    }
    /// Replace tiers starting at `offset` (pump's upsert semantics).
    pub fn upsert_fee_tiers(ctx: Context<FeeConfigAdmin>, fee_tiers: Vec<FeeTier>, offset: u8) -> Result<()> {
        let c = &mut ctx.accounts.fee_config;
        let mut tiers = c.fee_tiers.clone();
        let off = offset as usize;
        require!(off <= tiers.len(), FeeError::InvalidTierOffset);
        tiers.truncate(off);
        tiers.extend(fee_tiers);
        validate_tiers(&tiers)?;
        c.fee_tiers = tiers.clone();
        emit_cpi!(UpdateFeeConfigEvent { timestamp: now()?, admin: c.admin, fee_config: c.key(), flat_fees: c.flat_fees, fee_tiers: tiers });
        Ok(())
    }
    pub fn set_exotic_flat_fees(ctx: Context<FeeConfigAdmin>, exotic_flat_fees: Fees) -> Result<()> {
        validate_fees(&exotic_flat_fees)?;
        let c = &mut ctx.accounts.fee_config;
        c.exotic_flat_fees = exotic_flat_fees;
        emit_cpi!(SetExoticFlatFeesEvent { timestamp: now()?, admin: c.admin, fee_config: c.key(), exotic_flat_fees });
        Ok(())
    }
    pub fn update_admin(ctx: Context<FeeConfigAdmin>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.fee_config.admin = new_admin;
        Ok(())
    }
    /// View: fees for a trade (returned through return data).
    pub fn get_fees(ctx: Context<GetFees>, is_native_pool: bool, market_cap_lamports: u128, quote_mint: Pubkey) -> Result<Fees> {
        Ok(fees_for(&ctx.accounts.fee_config, is_native_pool, market_cap_lamports, quote_mint))
    }

    // ------------------------------------------------------------ fee sharing

    /// The coin's creator turns their creator fee into a shared stream. Reassigns the coin's creator
    /// (curve, and the AMM pool if graduated) to this SharingConfig PDA; starts with 100 % to the creator.
    pub fn create_fee_sharing_config(ctx: Context<CreateFeeSharingConfig>) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_SHARING == 0, FeeError::FeatureDeactivated);
        let creator = ctx.accounts.payer.key();
        require_keys_eq!(ctx.accounts.bonding_curve.creator, creator, FeeError::NotAuthorized);
        require!(!ctx.accounts.bonding_curve.is_holder_reward, FeeError::HolderRewardCoin);
        let state = &mut ctx.accounts.sharing_config;
        require!(state.version == 0, FeeError::AlreadyExists);
        state.bump = ctx.bumps.sharing_config;
        state.version = 2;
        state.status = ConfigStatus::Active;
        state.mint = ctx.accounts.mint.key();
        state.admin = creator;
        state.admin_revoked = false;
        state.shareholders = vec![Shareholder { address: creator, share_bps: BPS as u16 }];
        let sharing_key = state.key();

        // curve: creator -> sharing PDA (payer signs as current creator)
        openpump_curve::cpi::set_creator(
            CpiContext::new(
                ctx.accounts.curve_program.to_account_info(),
                openpump_curve::cpi::accounts::SetCreator {
                    creator: ctx.accounts.payer.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    bonding_curve: ctx.accounts.bonding_curve.to_account_info(),
                    event_authority: ctx.accounts.curve_event_authority.to_account_info(),
                    program: ctx.accounts.curve_program.to_account_info(),
                },
            ),
            sharing_key,
        )?;
        // AMM pool (graduated coins)
        if let (Some(pool), Some(amm), Some(ev), Some(gc)) = (&ctx.accounts.pool, &ctx.accounts.amm_program, &ctx.accounts.amm_event_authority, &ctx.accounts.amm_global_config) {
            openpump_amm::cpi::set_coin_creator(
                CpiContext::new(
                    amm.to_account_info(),
                    openpump_amm::cpi::accounts::SetCoinCreator {
                        coin_creator: ctx.accounts.payer.to_account_info(),
                        pool: pool.to_account_info(),
                        global_config: gc.to_account_info(),
                        event_authority: ev.to_account_info(),
                        program: amm.to_account_info(),
                    },
                ),
                sharing_key,
            )?;
        }
        emit_cpi!(CreateFeeSharingConfigEvent { timestamp: now()?, mint: ctx.accounts.mint.key(), sharing_config: sharing_key, admin: creator, initial_shareholders: ctx.accounts.sharing_config.shareholders.clone() });
        Ok(())
    }

    /// Admin sets a new split. Pending fees are paid to the *previous* shareholders first by the
    /// caller (client does `distribute_creator_fees` in the same transaction); on-chain we only
    /// require the vault to be empty so nobody's accrued share is re-split.
    pub fn update_fee_shares(ctx: Context<UpdateFeeShares>, shareholders: Vec<Shareholder>) -> Result<()> {
        let state = &mut ctx.accounts.sharing_config;
        require_keys_eq!(state.admin, ctx.accounts.authority.key(), FeeError::NotAuthorized);
        require!(!state.admin_revoked, FeeError::AdminRevoked);
        require!(state.status == ConfigStatus::Active, FeeError::NotActive);
        SharingConfig::validate_shares(&shareholders).map_err(|_| FeeError::InvalidShares)?;
        let rent_min = Rent::get()?.minimum_balance(0);
        require!(ctx.accounts.creator_vault.lamports() <= rent_min, FeeError::VaultNotEmpty);
        state.shareholders = shareholders.clone();
        emit_cpi!(UpdateFeeSharesEvent { timestamp: now()?, mint: state.mint, sharing_config: state.key(), admin: state.admin, new_shareholders: shareholders, version: state.version });
        Ok(())
    }
    pub fn transfer_fee_sharing_authority(ctx: Context<SharingAdmin>, new_admin: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.sharing_config;
        require!(!state.admin_revoked, FeeError::AdminRevoked);
        state.admin = new_admin;
        Ok(())
    }
    /// Lock the split forever.
    pub fn revoke_fee_sharing_authority(ctx: Context<SharingAdmin>) -> Result<()> {
        ctx.accounts.sharing_config.admin_revoked = true;
        Ok(())
    }
    /// Protocol authority: reset or pause a sharing config (community takeover of abandoned coins).
    pub fn admin_cto_sharing_config(ctx: Context<AdminCtoSharingConfig>, new_admin: Option<Pubkey>) -> Result<()> {
        let state = &mut ctx.accounts.sharing_config;
        let (old_admin, old_shareholders) = (state.admin, state.shareholders.clone());
        match new_admin {
            Some(a) => {
                state.admin = a;
                state.admin_revoked = false;
                state.status = ConfigStatus::Active;
                state.shareholders = vec![Shareholder { address: a, share_bps: BPS as u16 }];
            }
            None => {
                state.admin = Pubkey::default();
                state.admin_revoked = true;
                state.status = ConfigStatus::Paused;
                state.shareholders = vec![];
            }
        }
        emit_cpi!(ResetFeeSharingConfigEvent { timestamp: now()?, mint: state.mint, sharing_config: state.key(), old_admin, old_shareholders, new_admin: state.admin, new_shareholders: state.shareholders.clone() });
        Ok(())
    }

    // ------------------------------------------------------------ social fee PDAs

    pub fn create_social_fee_pda(ctx: Context<CreateSocialFeePda>, user_id: String, platform: u8) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_SOCIAL_CREATE == 0, FeeError::FeatureDeactivated);
        require!(!user_id.is_empty() && user_id.len() <= MAX_USER_ID, FeeError::UserIdTooLong);
        let s = &mut ctx.accounts.social_fee_pda;
        if s.version != 0 {
            return Ok(());
        }
        s.bump = ctx.bumps.social_fee_pda;
        s.version = 1;
        s.user_id = user_id.clone();
        s.platform = platform;
        emit_cpi!(SocialFeePdaCreated { timestamp: now()?, user_id, platform, social_fee_pda: s.key(), created_by: ctx.accounts.payer.key() });
        Ok(())
    }

    /// The social-claim authority (after verifying the social login off-chain) pays the PDA's SOL
    /// to the user's wallet. Rate limited per PDA.
    pub fn claim_social_fee_pda(ctx: Context<ClaimSocialFeePda>, _user_id: String, _platform: u8) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_SOCIAL_CLAIM == 0, FeeError::FeatureDeactivated);
        let ts = now()?;
        let limit = ctx.accounts.fee_program_global.claim_rate_limit;
        let s = &mut ctx.accounts.social_fee_pda;
        if s.last_claimed != 0 && (ts as u64).saturating_sub(s.last_claimed) < limit {
            return Ok(());
        }
        let info = s.to_account_info();
        let amount = info.lamports().saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        if amount == 0 || ctx.accounts.recipient.executable {
            return Ok(());
        }
        **info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;
        s.total_claimed = s.total_claimed.saturating_add(amount);
        s.last_claimed = ts as u64;
        emit_cpi!(SocialFeePdaClaimed { timestamp: ts, user_id: s.user_id.clone(), platform: s.platform, social_fee_pda: s.key(), recipient: ctx.accounts.recipient.key(), amount, lifetime_claimed: s.total_claimed, quote_mint: Pubkey::default() });
        Ok(())
    }

    /// Same for a custom-pair quote token held in the PDA's ATA.
    pub fn claim_social_fee_pda_v2(ctx: Context<ClaimSocialFeePdaV2>, _user_id: String, _platform: u8) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_SOCIAL_CLAIM == 0, FeeError::FeatureDeactivated);
        let ts = now()?;
        let limit = ctx.accounts.fee_program_global.claim_rate_limit;
        let s = &mut ctx.accounts.social_fee_pda;
        if s.last_claimed != 0 && (ts as u64).saturating_sub(s.last_claimed) < limit {
            return Ok(());
        }
        let amount = ctx.accounts.social_fee_pda_quote.amount;
        if amount == 0 {
            return Ok(());
        }
        let seeds: &[&[u8]] = &[SOCIAL_FEE_SEED, s.user_id.as_bytes(), &[s.platform], &[s.bump]];
        ti::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked { from: ctx.accounts.social_fee_pda_quote.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.recipient_quote.to_account_info(), authority: s.to_account_info() },
                &[seeds],
            ),
            amount,
            ctx.accounts.quote_mint.decimals,
        )?;
        s.total_stable_claimed = s.total_stable_claimed.saturating_add(amount);
        s.last_claimed = ts as u64;
        emit_cpi!(SocialFeePdaClaimed { timestamp: ts, user_id: s.user_id.clone(), platform: s.platform, social_fee_pda: s.key(), recipient: ctx.accounts.recipient.key(), amount, lifetime_claimed: s.total_stable_claimed, quote_mint: ctx.accounts.quote_mint.key() });
        Ok(())
    }

    // ------------------------------------------------------------ donations

    /// A creator routes their coin's creator fee to `beneficiary` (set the coin's creator to this PDA
    /// via the curve's `set_creator`; the PDA address is deterministic from mint + beneficiary).
    pub fn create_donation_fee_pda(ctx: Context<CreateDonationFeePda>) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_DONATION_CREATE == 0, FeeError::FeatureDeactivated);
        let d = &mut ctx.accounts.donation_fee_pda;
        if d.version != 0 {
            return Ok(());
        }
        d.bump = ctx.bumps.donation_fee_pda;
        d.version = 1;
        d.beneficiary = ctx.accounts.beneficiary.key();
        d.base_mint = ctx.accounts.base_mint.key();
        d.creator = ctx.accounts.payer.key();
        emit_cpi!(DonationFeePdaCreated { timestamp: now()?, created_by: ctx.accounts.payer.key(), donation_fee_pda: d.key(), beneficiary: d.beneficiary, base_mint: d.base_mint });
        Ok(())
    }
    /// Permissionless: forward everything the PDA holds (SOL above rent) to the beneficiary.
    pub fn crank_donation_fee_pda(ctx: Context<CrankDonationFeePda>) -> Result<()> {
        require!(ctx.accounts.fee_program_global.disable_flags & FLAG_DONATION_CRANK == 0, FeeError::FeatureDeactivated);
        let d = &mut ctx.accounts.donation_fee_pda;
        let info = d.to_account_info();
        let amount = info.lamports().saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        if amount == 0 {
            return Ok(());
        }
        **info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.beneficiary.to_account_info().try_borrow_mut_lamports()? += amount;
        d.total_donated = d.total_donated.saturating_add(amount);
        d.last_crank_ts = now()?;
        emit_cpi!(DonationFeePdaCranked { timestamp: d.last_crank_ts, signer: ctx.accounts.payer.key(), donation_fee_pda: d.key(), beneficiary: d.beneficiary, base_mint: d.base_mint, amount });
        Ok(())
    }

    // ------------------------------------------------------------ buyback vaults

    pub fn initialize_buyback(ctx: Context<InitializeBuyback>, index: u8, authority: Pubkey, claim_rate_limit: i64) -> Result<()> {
        let v = &mut ctx.accounts.buyback_vault;
        v.bump = ctx.bumps.buyback_vault;
        v.index = index;
        v.authority = authority;
        v.claim_rate_limit = claim_rate_limit;
        Ok(())
    }
    pub fn update_buyback_authority(ctx: Context<UpdateBuyback>, _index: u8, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.buyback_vault.authority = new_authority;
        Ok(())
    }
    pub fn update_buyback_claim_rate_limit(ctx: Context<UpdateBuyback>, _index: u8, claim_rate_limit: i64) -> Result<()> {
        ctx.accounts.buyback_vault.claim_rate_limit = claim_rate_limit;
        Ok(())
    }
    /// The buyback authority takes the accrued SOL to execute buybacks (rate limited).
    pub fn sweep_buyback(ctx: Context<SweepBuyback>, _index: u8) -> Result<()> {
        let ts = now()?;
        let v = &mut ctx.accounts.buyback_vault;
        require!(v.last_claimed == 0 || ts - v.last_claimed >= v.claim_rate_limit, FeeError::RateLimited);
        let info = v.to_account_info();
        let amount = info.lamports().saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        require!(amount > 0, FeeError::NothingToSweep);
        **info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        v.total_claimed = v.total_claimed.saturating_add(amount);
        v.last_claimed = ts;
        emit_cpi!(SweepBuybackEvent { timestamp: ts, index: v.index, authority: v.authority, amount, total_claimed: v.total_claimed });
        Ok(())
    }

    /// Authority withdraws stray SOL sent to the fee config PDA.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let info = ctx.accounts.fee_config.to_account_info();
        let amount = info.lamports().saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        require!(amount > 0, FeeError::NothingToSweep);
        **info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        Ok(())
    }
}

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
fn validate_fees(f: &Fees) -> Result<()> {
    require!(f.total() <= MAX_TOTAL_FEE_BPS, FeeError::FeeTooHigh);
    Ok(())
}
fn validate_tiers(t: &[FeeTier]) -> Result<()> {
    require!(t.len() <= MAX_TIERS, FeeError::TooManyTiers);
    for (i, tier) in t.iter().enumerate() {
        validate_fees(&tier.fees)?;
        if i > 0 {
            require!(tier.market_cap_lamports_threshold > t[i - 1].market_cap_lamports_threshold, FeeError::TiersNotSorted);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- state (program-private)

#[account]
#[derive(InitSpace)]
pub struct FeeProgramGlobal {
    pub bump: u8,
    pub authority: Pubkey,
    pub disable_flags: u8,
    pub social_claim_authority: Pubkey,
    pub claim_rate_limit: u64,
}

#[account]
#[derive(InitSpace)]
pub struct SocialFeePda {
    pub bump: u8,
    pub version: u8,
    #[max_len(MAX_USER_ID)]
    pub user_id: String,
    pub platform: u8,
    pub total_claimed: u64,
    pub last_claimed: u64,
    pub total_stable_claimed: u64,
}

#[account]
#[derive(InitSpace)]
pub struct DonationFeePda {
    pub bump: u8,
    pub version: u8,
    pub beneficiary: Pubkey,
    pub base_mint: Pubkey,
    pub creator: Pubkey,
    pub total_donated: u64,
    pub last_crank_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct BuybackVault {
    pub bump: u8,
    pub index: u8,
    pub authority: Pubkey,
    pub total_claimed: u64,
    pub last_claimed: i64,
    pub claim_rate_limit: i64,
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeFeeProgramGlobal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + FeeProgramGlobal::INIT_SPACE, seeds = [FEE_PROGRAM_GLOBAL_SEED], bump)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct GlobalAdmin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeFeeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(init, payer = authority, space = 8 + FeeConfig::INIT_SPACE, seeds = [FEE_CONFIG_SEED], bump)]
    pub fee_config: Account<'info, FeeConfig>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct FeeConfigAdmin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [FEE_CONFIG_SEED], bump = fee_config.bump, constraint = fee_config.admin == authority.key() @ FeeError::NotAuthorized)]
    pub fee_config: Account<'info, FeeConfig>,
}

#[derive(Accounts)]
pub struct GetFees<'info> {
    #[account(seeds = [FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, FeeConfig>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateFeeSharingConfig<'info> {
    /// Must be the coin's current creator.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(init_if_needed, payer = payer, space = 8 + SharingConfig::INIT_SPACE, seeds = [SHARING_CONFIG_SEED, mint.key().as_ref()], bump)]
    pub sharing_config: Account<'info, SharingConfig>,
    #[account(mut, seeds = [openpump_curve::BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, seeds::program = openpump_curve::ID, has_one = mint)]
    pub bonding_curve: Box<Account<'info, openpump_curve::BondingCurve>>,
    pub curve_program: Program<'info, openpump_curve::program::OpenpumpCurve>,
    /// CHECK: curve event authority PDA (validated by the curve during CPI).
    pub curve_event_authority: UncheckedAccount<'info>,
    /// Graduated coins: the migration pool, so the AMM-side creator is reassigned as well.
    #[account(mut)]
    pub pool: Option<Box<Account<'info, openpump_amm::Pool>>>,
    pub amm_program: Option<Program<'info, openpump_amm::program::OpenpumpAmm>>,
    /// CHECK: AMM event authority PDA.
    pub amm_event_authority: Option<UncheckedAccount<'info>>,
    /// CHECK: AMM global config PDA (validated by the AMM during CPI).
    pub amm_global_config: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateFeeShares<'info> {
    pub authority: Signer<'info>,
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, seeds = [SHARING_CONFIG_SEED, mint.key().as_ref()], bump = sharing_config.bump, has_one = mint)]
    pub sharing_config: Account<'info, SharingConfig>,
    /// CHECK: the curve creator vault of this sharing config; must be swept before re-splitting.
    #[account(seeds = [openpump_curve::CREATOR_VAULT_SEED, sharing_config.key().as_ref()], bump, seeds::program = openpump_curve::ID)]
    pub creator_vault: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SharingAdmin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SHARING_CONFIG_SEED, sharing_config.mint.as_ref()], bump = sharing_config.bump, constraint = sharing_config.admin == authority.key() @ FeeError::NotAuthorized)]
    pub sharing_config: Account<'info, SharingConfig>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct AdminCtoSharingConfig<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [SHARING_CONFIG_SEED, sharing_config.mint.as_ref()], bump = sharing_config.bump)]
    pub sharing_config: Account<'info, SharingConfig>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: String, platform: u8)]
pub struct CreateSocialFeePda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(init_if_needed, payer = payer, space = 8 + SocialFeePda::INIT_SPACE, seeds = [SOCIAL_FEE_SEED, user_id.as_bytes(), &[platform]], bump)]
    pub social_fee_pda: Account<'info, SocialFeePda>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: String, platform: u8)]
pub struct ClaimSocialFeePda<'info> {
    pub social_claim_authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = social_claim_authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [SOCIAL_FEE_SEED, user_id.as_bytes(), &[platform]], bump = social_fee_pda.bump)]
    pub social_fee_pda: Account<'info, SocialFeePda>,
    /// CHECK: the verified user's wallet.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(user_id: String, platform: u8)]
pub struct ClaimSocialFeePdaV2<'info> {
    #[account(mut)]
    pub social_claim_authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = social_claim_authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [SOCIAL_FEE_SEED, user_id.as_bytes(), &[platform]], bump = social_fee_pda.bump)]
    pub social_fee_pda: Account<'info, SocialFeePda>,
    /// CHECK: the verified user's wallet.
    pub recipient: UncheckedAccount<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = social_fee_pda, associated_token::token_program = quote_token_program)]
    pub social_fee_pda_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(init_if_needed, payer = social_claim_authority, associated_token::mint = quote_mint, associated_token::authority = recipient, associated_token::token_program = quote_token_program)]
    pub recipient_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateDonationFeePda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    /// CHECK: identifier only — the PDA may be created before the coin is launched so the launch
    /// can name it as creator.
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: any wallet.
    pub beneficiary: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + DonationFeePda::INIT_SPACE, seeds = [DONATION_FEE_SEED, base_mint.key().as_ref(), beneficiary.key().as_ref()], bump)]
    pub donation_fee_pda: Account<'info, DonationFeePda>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CrankDonationFeePda<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [DONATION_FEE_SEED, donation_fee_pda.base_mint.as_ref(), donation_fee_pda.beneficiary.as_ref()], bump = donation_fee_pda.bump, has_one = beneficiary)]
    pub donation_fee_pda: Account<'info, DonationFeePda>,
    /// CHECK: matched against the PDA's stored beneficiary.
    #[account(mut)]
    pub beneficiary: UncheckedAccount<'info>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct InitializeBuyback<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(init, payer = authority, space = 8 + BuybackVault::INIT_SPACE, seeds = [BUYBACK_SEED, &[index]], bump)]
    pub buyback_vault: Account<'info, BuybackVault>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct UpdateBuyback<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [BUYBACK_SEED, &[index]], bump = buyback_vault.bump)]
    pub buyback_vault: Account<'info, BuybackVault>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct SweepBuyback<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [BUYBACK_SEED, &[index]], bump = buyback_vault.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub buyback_vault: Account<'info, BuybackVault>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [FEE_PROGRAM_GLOBAL_SEED], bump = fee_program_global.bump, has_one = authority @ FeeError::NotAuthorized)]
    pub fee_program_global: Account<'info, FeeProgramGlobal>,
    #[account(mut, seeds = [FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, FeeConfig>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct InitializeFeeProgramGlobalEvent { pub timestamp: i64, pub authority: Pubkey, pub social_claim_authority: Pubkey, pub disable_flags: u8, pub claim_rate_limit: u64 }
#[event]
pub struct SetAuthorityEvent { pub timestamp: i64, pub old_authority: Pubkey, pub new_authority: Pubkey }
#[event]
pub struct SetSocialClaimAuthorityEvent { pub timestamp: i64, pub social_claim_authority: Pubkey }
#[event]
pub struct SetDisableFlagsEvent { pub timestamp: i64, pub disable_flags: u8 }
#[event]
pub struct SetClaimRateLimitEvent { pub timestamp: i64, pub claim_rate_limit: u64 }
#[event]
pub struct UpdateFeeConfigEvent { pub timestamp: i64, pub admin: Pubkey, pub fee_config: Pubkey, pub flat_fees: Fees, pub fee_tiers: Vec<FeeTier> }
#[event]
pub struct UpdateStableFeeConfigEvent { pub timestamp: i64, pub admin: Pubkey, pub fee_config: Pubkey, pub fee_tiers: Vec<FeeTier> }
#[event]
pub struct SetExoticFlatFeesEvent { pub timestamp: i64, pub admin: Pubkey, pub fee_config: Pubkey, pub exotic_flat_fees: Fees }
#[event]
pub struct CreateFeeSharingConfigEvent { pub timestamp: i64, pub mint: Pubkey, pub sharing_config: Pubkey, pub admin: Pubkey, pub initial_shareholders: Vec<Shareholder> }
#[event]
pub struct UpdateFeeSharesEvent { pub timestamp: i64, pub mint: Pubkey, pub sharing_config: Pubkey, pub admin: Pubkey, pub new_shareholders: Vec<Shareholder>, pub version: u8 }
#[event]
pub struct ResetFeeSharingConfigEvent { pub timestamp: i64, pub mint: Pubkey, pub sharing_config: Pubkey, pub old_admin: Pubkey, pub old_shareholders: Vec<Shareholder>, pub new_admin: Pubkey, pub new_shareholders: Vec<Shareholder> }
#[event]
pub struct SocialFeePdaCreated { pub timestamp: i64, pub user_id: String, pub platform: u8, pub social_fee_pda: Pubkey, pub created_by: Pubkey }
#[event]
pub struct SocialFeePdaClaimed { pub timestamp: i64, pub user_id: String, pub platform: u8, pub social_fee_pda: Pubkey, pub recipient: Pubkey, pub amount: u64, pub lifetime_claimed: u64, pub quote_mint: Pubkey }
#[event]
pub struct DonationFeePdaCreated { pub timestamp: i64, pub created_by: Pubkey, pub donation_fee_pda: Pubkey, pub beneficiary: Pubkey, pub base_mint: Pubkey }
#[event]
pub struct DonationFeePdaCranked { pub timestamp: i64, pub signer: Pubkey, pub donation_fee_pda: Pubkey, pub beneficiary: Pubkey, pub base_mint: Pubkey, pub amount: u64 }
#[event]
pub struct SweepBuybackEvent { pub timestamp: i64, pub index: u8, pub authority: Pubkey, pub amount: u64, pub total_claimed: u64 }

#[error_code]
pub enum FeeError {
    #[msg("Not authorized")]
    NotAuthorized,
    #[msg("Feature deactivated")]
    FeatureDeactivated,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Too many tiers / entries")]
    TooManyTiers,
    #[msg("Tiers must be sorted ascending by threshold")]
    TiersNotSorted,
    #[msg("Invalid tier offset")]
    InvalidTierOffset,
    #[msg("Invalid shareholders (1-10, unique, >0, sum 10000)")]
    InvalidShares,
    #[msg("Sharing config admin revoked")]
    AdminRevoked,
    #[msg("Sharing config not active")]
    NotActive,
    #[msg("Already exists")]
    AlreadyExists,
    #[msg("Holder-reward coins cannot share creator fees")]
    HolderRewardCoin,
    #[msg("Distribute pending fees before changing the split")]
    VaultNotEmpty,
    #[msg("user_id must be 1-32 bytes")]
    UserIdTooLong,
    #[msg("Rate limited")]
    RateLimited,
    #[msg("Nothing to sweep")]
    NothingToSweep,
}
