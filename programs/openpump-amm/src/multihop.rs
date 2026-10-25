//! Multi-hop swaps on the AMM (pump.fun `multi_hop_swap` parity for AMM legs): coin A → quote →
//! coin B (or any chain of pools joined by a shared mint) in ONE instruction, tokens moving
//! pool-to-pool so intermediate assets never touch the user's wallet.
//!
//! Remaining accounts: one group of 7 per leg, in route order:
//!   [pool, pool_base_token_account, pool_quote_token_account, base_mint, quote_mint,
//!    protocol_fee_recipient_token_account (quote), coin_creator_vault_ata (quote)]
//! Direction per leg is inferred from mint continuity: the leg's input mint is whatever the
//! previous leg produced (or the user's input mint for the first leg). Fees follow the normal
//! swap rules on every leg (LP stays in the pool, protocol + creator in that leg's quote token),
//! using the fees program's tier for that pool when `fee_config` is passed.
//!
//! Curve legs are composed by the client (sell on the curve, then buy with the proceeds) because
//! the curve pays SOL straight to the wallet; see `OpenpumpClient.routeIxs`.

use crate::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::spl_token_2022;

pub const LEG_ACCOUNTS: usize = 7;
pub const MAX_LEGS: usize = 4;

#[event]
pub struct MultiHopSwapEvent {
    pub user: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub legs: u8,
    pub timestamp: i64,
}

struct Leg<'a, 'info> {
    pool: &'a AccountInfo<'info>,
    base_vault: &'a AccountInfo<'info>,
    quote_vault: &'a AccountInfo<'info>,
    base_mint: &'a AccountInfo<'info>,
    quote_mint: &'a AccountInfo<'info>,
    protocol_fee_ata: &'a AccountInfo<'info>,
    creator_vault_ata: &'a AccountInfo<'info>,
    state: Pool,
}

fn token_amount(a: &AccountInfo) -> Result<u64> {
    let data = a.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize(&mut &data[..])?.amount)
}
fn mint_decimals(a: &AccountInfo) -> Result<u8> {
    let data = a.try_borrow_data()?;
    Ok(Mint::try_deserialize(&mut &data[..])?.decimals)
}
fn mint_supply(a: &AccountInfo) -> Result<u64> {
    let data = a.try_borrow_data()?;
    Ok(Mint::try_deserialize(&mut &data[..])?.supply)
}

fn program_for<'info>(ctx_token: &AccountInfo<'info>, ctx_2022: &AccountInfo<'info>, mint: &AccountInfo<'info>) -> Result<AccountInfo<'info>> {
    if *mint.owner == anchor_spl::token::ID {
        Ok(ctx_token.clone())
    } else if *mint.owner == spl_token_2022::ID {
        Ok(ctx_2022.clone())
    } else {
        Err(AmmError::RecipientsMismatch.into())
    }
}

fn transfer<'info>(program: AccountInfo<'info>, mint: &AccountInfo<'info>, from: AccountInfo<'info>, to: AccountInfo<'info>, authority: AccountInfo<'info>, seeds: Option<&[&[u8]]>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let dec = mint_decimals(mint)?;
    let ix = spl_token_2022::instruction::transfer_checked(program.key, from.key, mint.key, to.key, authority.key, &[], amount, dec)?;
    let infos = [from, mint.clone(), to, authority, program];
    match seeds {
        Some(s) => invoke_signed(&ix, &infos, &[s]),
        None => anchor_lang::solana_program::program::invoke(&ix, &infos),
    }?;
    Ok(())
}

pub fn multi_hop_swap<'info>(ctx: Context<'_, '_, 'info, 'info, MultiHopSwap<'info>>, amount_in: u64, min_amount_out: u64) -> Result<()> {
    let cfg = &ctx.accounts.global_config;
    require!(cfg.disable_flags & (DISABLE_BUY | DISABLE_SELL) == 0, AmmError::Disabled);
    require!(amount_in > 0, AmmError::ZeroAmount);
    let rem = ctx.remaining_accounts;
    require!(!rem.is_empty() && rem.len() % LEG_ACCOUNTS == 0 && rem.len() / LEG_ACCOUNTS <= MAX_LEGS, AmmError::RecipientsMismatch);

    // parse legs
    let mut legs: Vec<Leg> = Vec::with_capacity(rem.len() / LEG_ACCOUNTS);
    for g in rem.chunks_exact(LEG_ACCOUNTS) {
        require_keys_eq!(*g[0].owner, crate::ID, AmmError::RecipientsMismatch);
        let state = {
            let data = g[0].try_borrow_data()?;
            Pool::try_deserialize(&mut &data[..])?
        };
        require_keys_eq!(state.pool_base_token_account, g[1].key(), AmmError::RecipientsMismatch);
        require_keys_eq!(state.pool_quote_token_account, g[2].key(), AmmError::RecipientsMismatch);
        require_keys_eq!(state.base_mint, g[3].key(), AmmError::RecipientsMismatch);
        require_keys_eq!(state.quote_mint, g[4].key(), AmmError::RecipientsMismatch);
        require_keys_eq!(g[5].key(), anchor_spl::associated_token::get_associated_token_address_with_program_id(&cfg.protocol_fee_recipient, &state.quote_mint, g[4].owner), AmmError::InvalidFeeRecipient);
        let vault_auth = Pubkey::find_program_address(&[CREATOR_VAULT_SEED, state.coin_creator.as_ref()], &crate::ID).0;
        require_keys_eq!(g[6].key(), anchor_spl::associated_token::get_associated_token_address_with_program_id(&vault_auth, &state.quote_mint, g[4].owner), AmmError::RecipientsMismatch);
        legs.push(Leg { pool: &g[0], base_vault: &g[1], quote_vault: &g[2], base_mint: &g[3], quote_mint: &g[4], protocol_fee_ata: &g[5], creator_vault_ata: &g[6], state });
    }

    // route continuity: the user's input mint must be one side of leg 0, output mint one side of the last leg
    let input_mint = ctx.accounts.user_in_token_account.mint;
    let output_mint = ctx.accounts.user_out_token_account.mint;
    let tp = ctx.accounts.token_program.to_account_info();
    let tp22 = ctx.accounts.token_2022_program.to_account_info();
    let user = ctx.accounts.user.to_account_info();

    let mut current_mint = input_mint;
    let mut amount = amount_in;
    // source of the current leg's input: the user for leg 0, otherwise the previous pool's vault
    let mut src: (AccountInfo<'info>, AccountInfo<'info>, Option<Vec<Vec<u8>>>) = (ctx.accounts.user_in_token_account.to_account_info(), user.clone(), None);

    for (i, leg) in legs.iter().enumerate() {
        let st = &leg.state;
        let base_in = current_mint == st.base_mint;
        require!(base_in || current_mint == st.quote_mint, AmmError::RecipientsMismatch);
        let base_res = token_amount(leg.base_vault)?;
        let quote_res = token_amount(leg.quote_vault)?;
        let has_creator = st.coin_creator != Pubkey::default();
        let mut sched = schedule(cfg, &ctx.accounts.fee_config, base_res, quote_res, mint_supply(leg.base_mint)?, st.quote_mint);
        if st.creator_fee_bps > 0 {
            sched.creator = st.creator_fee_bps;
        }
        let pool_seeds: Vec<Vec<u8>> = vec![POOL_SEED.to_vec(), st.index.to_le_bytes().to_vec(), st.creator.to_bytes().to_vec(), st.base_mint.to_bytes().to_vec(), st.quote_mint.to_bytes().to_vec(), vec![st.bump]];
        let src_seed_refs: Option<Vec<&[u8]>> = src.2.as_ref().map(|v| v.iter().map(|s| s.as_slice()).collect());

        let (out_amount, out_mint, out_vault) = if base_in {
            // SELL base for quote on this leg
            let quote_out = quote_out_for_base_in(amount, base_res, quote_res)?;
            let fees = compute_fees(quote_out, &sched, has_creator)?;
            let net = quote_out.checked_sub(fees.lp + fees.protocol + fees.creator).ok_or(AmmError::MathOverflow)?;
            require!(net > 0, AmmError::ZeroAmount);
            // base in: src -> pool base vault
            transfer(program_for(&tp, &tp22, leg.base_mint)?, leg.base_mint, src.0.clone(), leg.base_vault.clone(), src.1.clone(), src_seed_refs.as_deref(), amount)?;
            // fees out of the pool's quote vault
            let qp = program_for(&tp, &tp22, leg.quote_mint)?;
            let seeds_ref: Vec<&[u8]> = pool_seeds.iter().map(|s| s.as_slice()).collect();
            transfer(qp.clone(), leg.quote_mint, leg.quote_vault.clone(), leg.protocol_fee_ata.clone(), leg.pool.clone(), Some(&seeds_ref), fees.protocol)?;
            if fees.creator > 0 {
                transfer(qp, leg.quote_mint, leg.quote_vault.clone(), leg.creator_vault_ata.clone(), leg.pool.clone(), Some(&seeds_ref), fees.creator)?;
            }
            (net, st.quote_mint, leg.quote_vault)
        } else {
            // BUY base with quote on this leg (exact quote in: fees come out of the input)
            let f_total = sched.lp + sched.protocol + if has_creator { sched.creator } else { 0 };
            let quote_net = mul_div_floor(amount, BPS_DENOMINATOR, BPS_DENOMINATOR.checked_add(f_total).ok_or(AmmError::MathOverflow)?)?;
            let fees = compute_fees(quote_net, &sched, has_creator)?;
            let pool_gets = amount.checked_sub(fees.protocol + fees.creator).ok_or(AmmError::MathOverflow)?; // includes lp fee + dust
            let base_out = base_out_for_quote_in(quote_net, base_res, quote_res)?;
            require!(base_out > 0 && base_out < base_res, AmmError::InsufficientLiquidity);
            // quote in: src -> pool quote vault (everything), then the pool pays protocol/creator fees out
            transfer(program_for(&tp, &tp22, leg.quote_mint)?, leg.quote_mint, src.0.clone(), leg.quote_vault.clone(), src.1.clone(), src_seed_refs.as_deref(), amount)?;
            let qp = program_for(&tp, &tp22, leg.quote_mint)?;
            let seeds_ref: Vec<&[u8]> = pool_seeds.iter().map(|s| s.as_slice()).collect();
            transfer(qp.clone(), leg.quote_mint, leg.quote_vault.clone(), leg.protocol_fee_ata.clone(), leg.pool.clone(), Some(&seeds_ref), fees.protocol)?;
            if fees.creator > 0 {
                transfer(qp, leg.quote_mint, leg.quote_vault.clone(), leg.creator_vault_ata.clone(), leg.pool.clone(), Some(&seeds_ref), fees.creator)?;
            }
            let _ = pool_gets;
            (base_out, st.base_mint, leg.base_vault)
        };

        // the last leg pays the user; intermediate legs hand off to the next pool directly
        if i == legs.len() - 1 {
            require_keys_eq!(out_mint, output_mint, AmmError::RecipientsMismatch);
            let seeds_ref: Vec<&[u8]> = pool_seeds.iter().map(|s| s.as_slice()).collect();
            let om = if base_in { leg.quote_mint } else { leg.base_mint };
            transfer(program_for(&tp, &tp22, om)?, om, out_vault.clone(), ctx.accounts.user_out_token_account.to_account_info(), leg.pool.clone(), Some(&seeds_ref), out_amount)?;
        } else {
            src = (out_vault.clone(), leg.pool.clone(), Some(pool_seeds.clone()));
        }
        current_mint = out_mint;
        amount = out_amount;
    }
    require!(amount >= min_amount_out, AmmError::ExceededSlippage);
    emit_cpi!(MultiHopSwapEvent { user: user.key(), input_mint, output_mint, amount_in, amount_out: amount, legs: legs.len() as u8, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct MultiHopSwap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, token::authority = user)]
    pub user_in_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::authority = user)]
    pub user_out_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(seeds = [FEE_CONFIG_SEED], bump = fee_config.bump, seeds::program = FEES_PROGRAM_ID)]
    pub fee_config: Option<Box<Account<'info, FeeConfig>>>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub token_2022_program: Program<'info, anchor_spl::token_2022::Token2022>,
}
