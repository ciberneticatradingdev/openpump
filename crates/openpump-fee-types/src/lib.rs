//! Account layouts owned by the OpenPump fees program that the curve and the AMM need to read,
//! plus the fee-tier selection shared by all three programs.
//!
//! Tier selection mirrors the selector recovered from pump.fun's fee program: if the market cap
//! is below the first threshold take the first tier, otherwise take the last tier whose threshold
//! is <= market cap.

use anchor_lang::prelude::*;

// The fees program id. `declare_id!` here makes `#[account]` types in this crate owned by it.
declare_id!("goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5");
pub const FEES_PROGRAM_ID: Pubkey = ID;

pub const FEE_PROGRAM_GLOBAL_SEED: &[u8] = b"fee-program-global";
pub const FEE_CONFIG_SEED: &[u8] = b"fee-config";
pub const SHARING_CONFIG_SEED: &[u8] = b"sharing-config";
pub const SOCIAL_FEE_SEED: &[u8] = b"social-fee-pda";
pub const DONATION_FEE_SEED: &[u8] = b"donation-fee-pda";
pub const BUYBACK_SEED: &[u8] = b"buyback";

pub const MAX_TIERS: usize = 16;
pub const MAX_SHAREHOLDERS: usize = 10;
pub const MAX_STABLE_MINTS: usize = 4;
pub const BPS: u64 = 10_000;
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct Fees {
    pub lp_fee_bps: u64,
    pub protocol_fee_bps: u64,
    pub creator_fee_bps: u64,
}

impl Fees {
    pub fn total(&self) -> u64 {
        self.lp_fee_bps.saturating_add(self.protocol_fee_bps).saturating_add(self.creator_fee_bps)
    }
    pub fn is_zero(&self) -> bool {
        self.total() == 0
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct FeeTier {
    /// Market cap (in quote base units, i.e. lamports for SOL) from which this tier applies.
    pub market_cap_lamports_threshold: u128,
    pub fees: Fees,
}

#[account]
#[derive(InitSpace)]
pub struct FeeConfig {
    pub bump: u8,
    pub admin: Pubkey,
    /// Used when no tier applies / for foreign pools.
    pub flat_fees: Fees,
    /// SOL-quoted coins (sorted ascending by threshold).
    #[max_len(MAX_TIERS)]
    pub fee_tiers: Vec<FeeTier>,
    /// Coins quoted in a stable mint listed in `stable_mints`.
    #[max_len(MAX_TIERS)]
    pub stable_fee_tiers: Vec<FeeTier>,
    /// Any other quote mint (custom pairs).
    pub exotic_flat_fees: Fees,
    #[max_len(MAX_STABLE_MINTS)]
    pub stable_mints: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct Shareholder {
    pub address: Pubkey,
    pub share_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum ConfigStatus {
    Paused,
    Active,
}

/// Per-coin creator fee split. When a coin's `creator` is this PDA, its creator fees accrue in the
/// PDA's creator vault and `distribute_creator_fees` (curve / AMM) pays the shareholders.
#[account]
#[derive(InitSpace)]
pub struct SharingConfig {
    pub bump: u8,
    pub version: u8,
    pub status: ConfigStatus,
    pub mint: Pubkey,
    pub admin: Pubkey,
    pub admin_revoked: bool,
    #[max_len(MAX_SHAREHOLDERS)]
    pub shareholders: Vec<Shareholder>,
}

impl SharingConfig {
    pub fn validate_shares(shares: &[Shareholder]) -> std::result::Result<(), &'static str> {
        if shares.is_empty() {
            return Err("no shareholders");
        }
        if shares.len() > MAX_SHAREHOLDERS {
            return Err("too many shareholders");
        }
        let mut sum: u32 = 0;
        for (i, s) in shares.iter().enumerate() {
            if s.share_bps == 0 {
                return Err("zero share");
            }
            if shares[..i].iter().any(|o| o.address == s.address) {
                return Err("duplicate shareholder");
            }
            sum += s.share_bps as u32;
        }
        if sum != BPS as u32 {
            return Err("shares must sum to 10000");
        }
        Ok(())
    }
}

/// pump.fun's selector: first tier if below its threshold, else the last tier at or below the cap.
pub fn select_fee_tier(tiers: &[FeeTier], market_cap: u128) -> Option<Fees> {
    let first = tiers.first()?;
    if market_cap < first.market_cap_lamports_threshold {
        return Some(first.fees);
    }
    for t in tiers.iter().rev() {
        if market_cap >= t.market_cap_lamports_threshold {
            return Some(t.fees);
        }
    }
    Some(first.fees)
}

/// Fees for a trade. `native_pool`: an OpenPump curve or migration pool (foreign AMM pools get flat fees).
pub fn fees_for(cfg: &FeeConfig, native_pool: bool, market_cap: u128, quote_mint: Pubkey) -> Fees {
    if !native_pool {
        return cfg.flat_fees;
    }
    if quote_mint == Pubkey::default() || quote_mint == WSOL {
        return select_fee_tier(&cfg.fee_tiers, market_cap).unwrap_or(cfg.flat_fees);
    }
    if cfg.stable_mints.contains(&quote_mint) {
        return select_fee_tier(&cfg.stable_fee_tiers, market_cap).unwrap_or(cfg.flat_fees);
    }
    if cfg.exotic_flat_fees.is_zero() { cfg.flat_fees } else { cfg.exotic_flat_fees }
}

/// Market cap in quote base units: spot price (virtual quote / virtual token) times total supply.
pub fn market_cap(virtual_quote: u64, virtual_token: u64, total_supply: u64) -> u128 {
    if virtual_token == 0 {
        return 0;
    }
    (virtual_quote as u128).saturating_mul(total_supply as u128) / virtual_token as u128
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(th: u128, p: u64, c: u64) -> FeeTier {
        FeeTier { market_cap_lamports_threshold: th, fees: Fees { lp_fee_bps: 0, protocol_fee_bps: p, creator_fee_bps: c } }
    }
    #[test]
    fn selector_matches_pump_semantics() {
        let tiers = [t(0, 50, 50), t(150e9 as u128, 45, 45), t(500e9 as u128, 40, 40)];
        assert_eq!(select_fee_tier(&tiers, 0).unwrap().protocol_fee_bps, 50);
        assert_eq!(select_fee_tier(&tiers, 149e9 as u128).unwrap().protocol_fee_bps, 50);
        assert_eq!(select_fee_tier(&tiers, 150e9 as u128).unwrap().protocol_fee_bps, 45);
        assert_eq!(select_fee_tier(&tiers, 10_000e9 as u128).unwrap().protocol_fee_bps, 40);
        assert!(select_fee_tier(&[], 1).is_none());
        // first-threshold rule even when unsorted
        let unsorted = [t(100, 1, 1), t(10, 2, 2)];
        assert_eq!(select_fee_tier(&unsorted, 50).unwrap().protocol_fee_bps, 1);
    }
    #[test]
    fn shares_validation() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        assert!(SharingConfig::validate_shares(&[Shareholder { address: a, share_bps: 6000 }, Shareholder { address: b, share_bps: 4000 }]).is_ok());
        assert!(SharingConfig::validate_shares(&[Shareholder { address: a, share_bps: 6000 }]).is_err());
        assert!(SharingConfig::validate_shares(&[Shareholder { address: a, share_bps: 5000 }, Shareholder { address: a, share_bps: 5000 }]).is_err());
    }
}
