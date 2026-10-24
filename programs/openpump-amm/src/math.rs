//! Constant-product math, all in u128 with explicit rounding in the pool's favour.

use crate::{AmmError, BPS_DENOMINATOR};
use anchor_lang::prelude::*;

pub fn mul_div_floor(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d > 0, AmmError::MathOverflow);
    let r = (a as u128).checked_mul(b as u128).ok_or(AmmError::MathOverflow)? / d as u128;
    u64::try_from(r).map_err(|_| AmmError::MathOverflow.into())
}

pub fn mul_div_ceil(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d > 0, AmmError::MathOverflow);
    let num = (a as u128).checked_mul(b as u128).ok_or(AmmError::MathOverflow)?;
    let r = num.div_ceil(d as u128);
    u64::try_from(r).map_err(|_| AmmError::MathOverflow.into())
}

/// Fee rounded up (so dust never leaks to the trader).
pub fn fee_ceil(amount: u64, bps: u64) -> Result<u64> {
    if bps == 0 {
        return Ok(0);
    }
    mul_div_ceil(amount, bps, BPS_DENOMINATOR)
}

/// Quote needed to pull `base_out` from the pool: ceil(base_out * Q / (B - base_out)).
pub fn quote_in_for_base_out(base_out: u64, base_reserve: u64, quote_reserve: u64) -> Result<u64> {
    require!(base_out < base_reserve, AmmError::InsufficientLiquidity);
    mul_div_ceil(base_out, quote_reserve, base_reserve - base_out)
}

/// Quote received for pushing `base_in` into the pool: floor(base_in * Q / (B + base_in)).
pub fn quote_out_for_base_in(base_in: u64, base_reserve: u64, quote_reserve: u64) -> Result<u64> {
    let denom = (base_reserve as u128).checked_add(base_in as u128).ok_or(AmmError::MathOverflow)?;
    let num = (base_in as u128).checked_mul(quote_reserve as u128).ok_or(AmmError::MathOverflow)?;
    u64::try_from(num / denom).map_err(|_| AmmError::MathOverflow.into())
}

/// Base received for `quote_in` (used by clients for quoting; not used on-chain by buy).
pub fn base_out_for_quote_in(quote_in: u64, base_reserve: u64, quote_reserve: u64) -> Result<u64> {
    let denom = (quote_reserve as u128).checked_add(quote_in as u128).ok_or(AmmError::MathOverflow)?;
    let num = (quote_in as u128).checked_mul(base_reserve as u128).ok_or(AmmError::MathOverflow)?;
    u64::try_from(num / denom).map_err(|_| AmmError::MathOverflow.into())
}

/// Initial LP supply = floor(sqrt(base * quote)).
pub fn initial_lp_amount(base: u64, quote: u64) -> Result<u64> {
    let prod = (base as u128).checked_mul(quote as u128).ok_or(AmmError::MathOverflow)?;
    u64::try_from(isqrt(prod)).map_err(|_| AmmError::MathOverflow.into())
}

pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = 1u128 << ((128 - n.leading_zeros()).div_ceil(2));
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_exact_and_floor() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(15), 3);
        assert_eq!(isqrt(16), 4);
        assert_eq!(isqrt(u128::from(u64::MAX) * u128::from(u64::MAX)), u128::from(u64::MAX));
    }

    #[test]
    fn buy_then_sell_never_profits() {
        let (b, q) = (206_900_000_000_000u64, 85_000_000_000u64);
        for out in [1u64, 1_000_000, 10_000_000_000_000] {
            let qin = quote_in_for_base_out(out, b, q).unwrap();
            let qout = quote_out_for_base_in(out, b - out, q + qin).unwrap();
            assert!(qout <= qin, "round trip gained quote: {qin} -> {qout}");
        }
    }

    #[test]
    fn fee_rounds_up() {
        assert_eq!(fee_ceil(1, 25).unwrap(), 1);
        assert_eq!(fee_ceil(10_000, 25).unwrap(), 25);
        assert_eq!(fee_ceil(10_001, 25).unwrap(), 26);
        assert_eq!(fee_ceil(123, 0).unwrap(), 0);
    }
}
