//! Virtual-reserve constant-product math (x * y = k), u128 intermediates, rounding in the
//! curve's favour. Defaults (set via `initialize`) mirror pump.fun's public numbers:
//!   virtual SOL 30, virtual tokens 1,073,000,000, real tokens 793,100,000, supply 1,000,000,000
//! so a curve completes after ~85 SOL and migrates at the same spot price.

use crate::{BPS_DENOMINATOR, CurveError};
use anchor_lang::prelude::*;

pub fn mul_div_floor(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d > 0, CurveError::MathOverflow);
    let r = (a as u128).checked_mul(b as u128).ok_or(CurveError::MathOverflow)? / d as u128;
    u64::try_from(r).map_err(|_| CurveError::MathOverflow.into())
}

pub fn mul_div_ceil(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d > 0, CurveError::MathOverflow);
    let num = (a as u128).checked_mul(b as u128).ok_or(CurveError::MathOverflow)?;
    u64::try_from(num.div_ceil(d as u128)).map_err(|_| CurveError::MathOverflow.into())
}

pub fn fee_ceil(amount: u64, bps: u64) -> Result<u64> {
    if bps == 0 {
        return Ok(0);
    }
    mul_div_ceil(amount, bps, BPS_DENOMINATOR)
}

/// SOL the buyer pays (before fees) to receive `tokens_out`: ceil(t * vS / (vT - t)).
pub fn sol_in_for_tokens_out(tokens_out: u64, v_sol: u64, v_tok: u64) -> Result<u64> {
    require!(tokens_out < v_tok, CurveError::InsufficientReserves);
    mul_div_ceil(tokens_out, v_sol, v_tok - tokens_out)
}

/// Tokens received for `sol_in` (before fees): floor(s * vT / (vS + s)).
pub fn tokens_out_for_sol_in(sol_in: u64, v_sol: u64, v_tok: u64) -> Result<u64> {
    let denom = (v_sol as u128).checked_add(sol_in as u128).ok_or(CurveError::MathOverflow)?;
    let num = (sol_in as u128).checked_mul(v_tok as u128).ok_or(CurveError::MathOverflow)?;
    u64::try_from(num / denom).map_err(|_| CurveError::MathOverflow.into())
}

/// SOL the seller receives (before fees) for `tokens_in`: floor(t * vS / (vT + t)).
pub fn sol_out_for_tokens_in(tokens_in: u64, v_sol: u64, v_tok: u64) -> Result<u64> {
    let denom = (v_tok as u128).checked_add(tokens_in as u128).ok_or(CurveError::MathOverflow)?;
    let num = (tokens_in as u128).checked_mul(v_sol as u128).ok_or(CurveError::MathOverflow)?;
    u64::try_from(num / denom).map_err(|_| CurveError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const V_SOL: u64 = 30_000_000_000;
    const V_TOK: u64 = 1_073_000_000_000_000;
    const REAL_TOK: u64 = 793_100_000_000_000;

    #[test]
    fn curve_completes_near_85_sol() {
        let sol = sol_in_for_tokens_out(REAL_TOK, V_SOL, V_TOK).unwrap();
        assert!(sol > 85_000_000_000 && sol < 85_010_000_000, "{sol}");
    }

    #[test]
    fn migration_price_is_continuous() {
        // price on the curve at completion vs price in the pool (fee 0)
        let sol = sol_in_for_tokens_out(REAL_TOK, V_SOL, V_TOK).unwrap();
        let curve_price = (V_SOL + sol) as f64 / (V_TOK - REAL_TOK) as f64;
        let pool_price = sol as f64 / (1_000_000_000_000_000u64 - REAL_TOK) as f64;
        // pump.fun's constants are continuous to ~0.007 %, not exactly
        assert!((curve_price - pool_price).abs() / curve_price < 1e-3);
    }

    #[test]
    fn round_trip_never_profits() {
        for t in [1u64, 1_000_000, 50_000_000_000_000] {
            let s_in = sol_in_for_tokens_out(t, V_SOL, V_TOK).unwrap();
            let s_out = sol_out_for_tokens_in(t, V_SOL + s_in, V_TOK - t).unwrap();
            assert!(s_out <= s_in);
            let t2 = tokens_out_for_sol_in(s_in, V_SOL, V_TOK).unwrap();
            // the ceil'd lamport can buy up to vT/vS extra token units
            assert!(t2 >= t && t2 - t <= V_TOK / V_SOL + 1, "exact-sol path should match tokens path: {t} vs {t2}");
        }
    }
}
