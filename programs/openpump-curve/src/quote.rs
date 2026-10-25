//! Custom pairs ("v2" family): bonding curves whose quote asset is an SPL / Token-2022 mint
//! instead of native SOL. Mirrors pump.fun's quote-mint instructions (create_v2, buy_v2,
//! buy_exact_quote_in, sell_v2, collect_creator_fee_v2, migrate_v2) with the same curve math.
//!
//! Every quote mint is enabled by the authority through a `QuoteConfig` that carries its own
//! initial virtual reserves (so e.g. a coin paired with $OPENPUMP starts at a sensible price).
//! Fees are paid in the quote asset: protocol -> fee recipient's quote ATA,
//! creator -> quote ATA owned by the creator's vault PDA (same PDA as the SOL vault).

use crate::*;
use anchor_spl::token_interface::{
    self as ti, Mint as MintI, TokenAccount as TokenAccountI, TokenInterface, TransferChecked,
};

pub const QUOTE_CONFIG_SEED: &[u8] = b"quote-config";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct QuoteParams {
    pub enabled: bool,
    pub initial_virtual_quote_reserves: u64,
    pub initial_virtual_token_reserves: u64,
    pub initial_real_token_reserves: u64,
    /// Flat fee in quote base units taken from the curve at migration.
    pub migration_fee: u64,
}

#[account]
#[derive(InitSpace)]
pub struct QuoteConfig {
    pub quote_mint: Pubkey,
    pub enabled: bool,
    pub initial_virtual_quote_reserves: u64,
    pub initial_virtual_token_reserves: u64,
    pub initial_real_token_reserves: u64,
    pub migration_fee: u64,
    pub decimals: u8,
    pub bump: u8,
}

#[event]
pub struct SetQuoteConfigEvent {
    pub quote_mint: Pubkey,
    pub params: QuoteParams,
    pub timestamp: i64,
}

// ---------------------------------------------------------------- handlers

pub fn set_quote_config(ctx: Context<SetQuoteConfig>, params: QuoteParams) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(params.initial_virtual_quote_reserves > 0 && params.initial_virtual_token_reserves > 0, CurveError::InvalidParams);
    require!(params.initial_real_token_reserves > 0 && params.initial_real_token_reserves < g.token_total_supply, CurveError::InvalidParams);
    require!(params.initial_real_token_reserves < params.initial_virtual_token_reserves, CurveError::InvalidParams);
    require_keys_neq!(ctx.accounts.quote_mint.key(), WSOL_MINT, CurveError::InvalidParams);
    let q = &mut ctx.accounts.quote_config;
    q.quote_mint = ctx.accounts.quote_mint.key();
    q.enabled = params.enabled;
    q.initial_virtual_quote_reserves = params.initial_virtual_quote_reserves;
    q.initial_virtual_token_reserves = params.initial_virtual_token_reserves;
    q.initial_real_token_reserves = params.initial_real_token_reserves;
    q.migration_fee = params.migration_fee;
    q.decimals = ctx.accounts.quote_mint.decimals;
    q.bump = ctx.bumps.quote_config;
    emit_cpi!(SetQuoteConfigEvent { quote_mint: q.quote_mint, params, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn create_v2(ctx: Context<CreateV2>, name: String, symbol: String, uri: String, is_holder_reward: bool, creator: Pubkey) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, CurveError::Paused);
    require!(!is_holder_reward || g.holder_reward_enabled, CurveError::HolderRewardDisabled);
    require!(ctx.accounts.quote_config.enabled, CurveError::QuoteMintDisabled);
    require!(name.len() <= 32 && symbol.len() <= 10 && uri.len() <= 200, CurveError::MetadataTooLong);

    let mint_auth_seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]];
    let signer: &[&[&[u8]]] = &[mint_auth_seeds];
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.mpl_token_metadata.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.mint_authority.to_account_info(),
                payer: ctx.accounts.user.to_account_info(),
                update_authority: ctx.accounts.mint_authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer,
        ),
        DataV2 { name: name.clone(), symbol: symbol.clone(), uri: uri.clone(), seller_fee_basis_points: 0, creators: None, collection: None, uses: None },
        false,
        true,
        None,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo { mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.associated_bonding_curve.to_account_info(), authority: ctx.accounts.mint_authority.to_account_info() },
            signer,
        ),
        g.token_total_supply,
    )?;
    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority { current_authority: ctx.accounts.mint_authority.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info() },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    let q = &ctx.accounts.quote_config;
    let clock = Clock::get()?;
    let bc = &mut ctx.accounts.bonding_curve;
    bc.mint = ctx.accounts.mint.key();
    bc.creator = if is_holder_reward { holder_rewards_pda(&bc.mint) } else if creator == Pubkey::default() { ctx.accounts.user.key() } else { creator };
    bc.is_holder_reward = is_holder_reward;
    bc.virtual_token_reserves = q.initial_virtual_token_reserves;
    bc.virtual_sol_reserves = q.initial_virtual_quote_reserves;
    bc.real_token_reserves = q.initial_real_token_reserves;
    bc.real_sol_reserves = 0;
    bc.token_total_supply = g.token_total_supply;
    bc.complete = false;
    bc.migrated = false;
    bc.created_slot = clock.slot;
    bc.creator_fees_total = 0;
    bc.protocol_fees_total = 0;
    bc.bump = ctx.bumps.bonding_curve;
    bc.quote_mint = q.quote_mint;

    emit_cpi!(CreateEvent {
        name, symbol, uri,
        mint: bc.mint,
        bonding_curve: bc.key(),
        user: bc.creator,
        creator: bc.creator,
        virtual_token_reserves: bc.virtual_token_reserves,
        virtual_sol_reserves: bc.virtual_sol_reserves,
        real_token_reserves: bc.real_token_reserves,
        token_total_supply: bc.token_total_supply,
        timestamp: clock.unix_timestamp,
        quote_mint: bc.quote_mint,
        is_holder_reward: bc.is_holder_reward,
    });
    Ok(())
}

pub fn buy_v2(ctx: Context<TradeV2>, amount: u64, max_quote_cost: u64) -> Result<()> {
    require!(amount > 0, CurveError::ZeroAmount);
    let bc = &ctx.accounts.bonding_curve;
    let tokens_out = amount.min(bc.real_token_reserves);
    let quote_in = sol_in_for_tokens_out(tokens_out, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
    execute_buy_v2(ctx, tokens_out, quote_in, max_quote_cost)
}

pub fn buy_exact_quote_in(ctx: Context<TradeV2>, quote_in: u64, min_tokens_out: u64) -> Result<()> {
    require!(quote_in > 0, CurveError::ZeroAmount);
    let bc = &ctx.accounts.bonding_curve;
    let g = &ctx.accounts.global;
    let mut tokens_out = tokens_out_for_sol_in(quote_in, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
    let mut spend = quote_in;
    if tokens_out >= bc.real_token_reserves {
        tokens_out = bc.real_token_reserves;
        spend = sol_in_for_tokens_out(tokens_out, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
    }
    require!(tokens_out >= min_tokens_out, CurveError::ExceededSlippage);
    let (p_bps, c_bps) = trade_fee_bps(g, &ctx.accounts.fee_config, bc);
    let fees = fee_ceil(spend, p_bps)?.checked_add(fee_ceil(spend, c_bps)?).ok_or(CurveError::MathOverflow)?;
    execute_buy_v2(ctx, tokens_out, spend, spend.checked_add(fees).ok_or(CurveError::MathOverflow)?)
}

fn execute_buy_v2(ctx: Context<TradeV2>, tokens_out: u64, quote_in: u64, max_quote_cost: u64) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, CurveError::Paused);
    let bc = &ctx.accounts.bonding_curve;
    require!(!bc.complete, CurveError::CurveComplete);
    require!(tokens_out > 0 && quote_in > 0, CurveError::ZeroAmount);

    let clock = Clock::get()?;
    if g.anti_snipe_slots > 0 && clock.slot < bc.created_slot.saturating_add(g.anti_snipe_slots) {
        let cap = mul_div_floor(bc.token_total_supply, g.anti_snipe_max_bps, BPS_DENOMINATOR)?;
        require!(tokens_out <= cap, CurveError::AntiSnipeCap);
    }
    let (p_bps, c_bps) = trade_fee_bps(g, &ctx.accounts.fee_config, bc);
    let protocol_fee = fee_ceil(quote_in, p_bps)?;
    let creator_fee = fee_ceil(quote_in, c_bps)?;
    let total = quote_in.checked_add(protocol_fee).and_then(|v| v.checked_add(creator_fee)).ok_or(CurveError::MathOverflow)?;
    require!(total <= max_quote_cost, CurveError::ExceededSlippage);

    // quote: user -> curve / fee recipient / creator vault
    let dec = ctx.accounts.quote_mint.decimals;
    let qp = ctx.accounts.quote_token_program.to_account_info();
    let from = ctx.accounts.user_quote.to_account_info();
    let qm = ctx.accounts.quote_mint.to_account_info();
    let user = ctx.accounts.user.to_account_info();
    for (to, amt) in [
        (ctx.accounts.bonding_curve_quote.to_account_info(), quote_in),
        (ctx.accounts.fee_recipient_quote.to_account_info(), protocol_fee),
        (ctx.accounts.creator_vault_quote.to_account_info(), creator_fee),
    ] {
        if amt > 0 {
            ti::transfer_checked(CpiContext::new(qp.clone(), TransferChecked { from: from.clone(), mint: qm.clone(), to, authority: user.clone() }), amt, dec)?;
        }
    }

    // tokens: curve -> user
    let mint_key = bc.mint;
    let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bc.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.associated_bonding_curve.to_account_info(), to: ctx.accounts.associated_user.to_account_info(), authority: ctx.accounts.bonding_curve.to_account_info() },
            &[bc_seeds],
        ),
        tokens_out,
    )?;

    let bc = &mut ctx.accounts.bonding_curve;
    bc.virtual_token_reserves = bc.virtual_token_reserves.checked_sub(tokens_out).ok_or(CurveError::MathOverflow)?;
    bc.real_token_reserves = bc.real_token_reserves.checked_sub(tokens_out).ok_or(CurveError::MathOverflow)?;
    bc.virtual_sol_reserves = bc.virtual_sol_reserves.checked_add(quote_in).ok_or(CurveError::MathOverflow)?;
    bc.real_sol_reserves = bc.real_sol_reserves.checked_add(quote_in).ok_or(CurveError::MathOverflow)?;
    bc.protocol_fees_total = bc.protocol_fees_total.saturating_add(protocol_fee);
    bc.creator_fees_total = bc.creator_fees_total.saturating_add(creator_fee);
    if bc.real_token_reserves == 0 {
        bc.complete = true;
    }
    emit_cpi!(TradeEvent {
        mint: bc.mint, sol_amount: quote_in, token_amount: tokens_out, is_buy: true, user: ctx.accounts.user.key(), timestamp: clock.unix_timestamp,
        virtual_sol_reserves: bc.virtual_sol_reserves, virtual_token_reserves: bc.virtual_token_reserves,
        real_sol_reserves: bc.real_sol_reserves, real_token_reserves: bc.real_token_reserves,
        protocol_fee, creator_fee, creator: bc.creator, quote_mint: bc.quote_mint, buyback_fee: 0,
    });
    if bc.complete {
        emit_cpi!(CompleteEvent { mint: bc.mint, bonding_curve: bc.key(), user: ctx.accounts.user.key(), real_sol_reserves: bc.real_sol_reserves, timestamp: clock.unix_timestamp });
    }
    Ok(())
}

pub fn sell_v2(ctx: Context<TradeV2>, amount: u64, min_quote_output: u64) -> Result<()> {
    require!(amount > 0, CurveError::ZeroAmount);
    let g = &ctx.accounts.global;
    require!(!g.paused, CurveError::Paused);
    let bc = &ctx.accounts.bonding_curve;
    require!(!bc.complete, CurveError::CurveComplete);

    let quote_out = sol_out_for_tokens_in(amount, bc.virtual_sol_reserves, bc.virtual_token_reserves)?;
    require!(quote_out <= bc.real_sol_reserves, CurveError::InsufficientReserves);
    let (p_bps, c_bps) = trade_fee_bps(g, &ctx.accounts.fee_config, bc);
    let protocol_fee = fee_ceil(quote_out, p_bps)?;
    let creator_fee = fee_ceil(quote_out, c_bps)?;
    let user_out = quote_out.checked_sub(protocol_fee).and_then(|v| v.checked_sub(creator_fee)).ok_or(CurveError::MathOverflow)?;
    require!(user_out >= min_quote_output, CurveError::ExceededSlippage);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.associated_user.to_account_info(), to: ctx.accounts.associated_bonding_curve.to_account_info(), authority: ctx.accounts.user.to_account_info() },
        ),
        amount,
    )?;

    let mint_key = bc.mint;
    let bump = bc.bump;
    let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bump]];
    let dec = ctx.accounts.quote_mint.decimals;
    let qp = ctx.accounts.quote_token_program.to_account_info();
    let from = ctx.accounts.bonding_curve_quote.to_account_info();
    let qm = ctx.accounts.quote_mint.to_account_info();
    let auth = ctx.accounts.bonding_curve.to_account_info();
    for (to, amt) in [
        (ctx.accounts.user_quote.to_account_info(), user_out),
        (ctx.accounts.fee_recipient_quote.to_account_info(), protocol_fee),
        (ctx.accounts.creator_vault_quote.to_account_info(), creator_fee),
    ] {
        if amt > 0 {
            ti::transfer_checked(CpiContext::new_with_signer(qp.clone(), TransferChecked { from: from.clone(), mint: qm.clone(), to, authority: auth.clone() }, &[bc_seeds]), amt, dec)?;
        }
    }

    let bc = &mut ctx.accounts.bonding_curve;
    bc.virtual_token_reserves = bc.virtual_token_reserves.checked_add(amount).ok_or(CurveError::MathOverflow)?;
    bc.real_token_reserves = bc.real_token_reserves.checked_add(amount).ok_or(CurveError::MathOverflow)?;
    bc.virtual_sol_reserves = bc.virtual_sol_reserves.checked_sub(quote_out).ok_or(CurveError::MathOverflow)?;
    bc.real_sol_reserves = bc.real_sol_reserves.checked_sub(quote_out).ok_or(CurveError::MathOverflow)?;
    bc.protocol_fees_total = bc.protocol_fees_total.saturating_add(protocol_fee);
    bc.creator_fees_total = bc.creator_fees_total.saturating_add(creator_fee);
    emit_cpi!(TradeEvent {
        mint: bc.mint, sol_amount: quote_out, token_amount: amount, is_buy: false, user: ctx.accounts.user.key(), timestamp: Clock::get()?.unix_timestamp,
        virtual_sol_reserves: bc.virtual_sol_reserves, virtual_token_reserves: bc.virtual_token_reserves,
        real_sol_reserves: bc.real_sol_reserves, real_token_reserves: bc.real_token_reserves,
        protocol_fee, creator_fee, creator: bc.creator, quote_mint: bc.quote_mint, buyback_fee: 0,
    });
    Ok(())
}

pub fn collect_creator_fee_v2(ctx: Context<CollectCreatorFeeV2>) -> Result<()> {
    let amount = ctx.accounts.creator_vault_quote.amount;
    require!(amount > 0, CurveError::ZeroAmount);
    let creator_key = ctx.accounts.creator.key();
    let seeds: &[&[u8]] = &[CREATOR_VAULT_SEED, creator_key.as_ref(), &[ctx.bumps.creator_vault]];
    ti::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.creator_vault_quote.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.creator_quote.to_account_info(),
                authority: ctx.accounts.creator_vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;
    emit_cpi!(CollectCreatorFeeEvent { creator: creator_key, amount, timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn migrate_v2(ctx: Context<MigrateV2>) -> Result<()> {
    let bc = &ctx.accounts.bonding_curve;
    require!(bc.complete, CurveError::CurveNotComplete);
    require!(!bc.migrated, CurveError::AlreadyMigrated);
    let fee = ctx.accounts.quote_config.migration_fee;
    let base_amount = ctx.accounts.associated_bonding_curve.amount;
    require!(base_amount > 0, CurveError::InsufficientReserves);
    let quote_amount = bc.real_sol_reserves.checked_sub(fee).ok_or(CurveError::InsufficientReserves)?;
    require!(quote_amount > 0, CurveError::InsufficientReserves);

    let mint_key = bc.mint;
    let bc_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &[bc.bump]];
    let bc_signer: &[&[&[u8]]] = &[bc_seeds];
    let bc_info = ctx.accounts.bonding_curve.to_account_info();
    let dec = ctx.accounts.quote_mint.decimals;

    // 1. migration fee in quote -> fee recipient
    if fee > 0 {
        ti::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.quote_token_program.to_account_info(),
                TransferChecked { from: ctx.accounts.bonding_curve_quote.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.fee_recipient_quote.to_account_info(), authority: bc_info.clone() },
                bc_signer,
            ),
            fee,
            dec,
        )?;
    }

    // 2. create the AMM pool with the quote token directly (no wrapping needed)
    openpump_amm::cpi::create_pool(
        CpiContext::new_with_signer(
            ctx.accounts.amm_program.to_account_info(),
            openpump_amm::cpi::accounts::CreatePool {
                pool: ctx.accounts.pool.to_account_info(),
                global_config: ctx.accounts.amm_global_config.to_account_info(),
                creator: bc_info.clone(),
                payer: ctx.accounts.user.to_account_info(),
                base_mint: ctx.accounts.mint.to_account_info(),
                quote_mint: ctx.accounts.quote_mint.to_account_info(),
                lp_mint: ctx.accounts.lp_mint.to_account_info(),
                user_base_token_account: ctx.accounts.associated_bonding_curve.to_account_info(),
                user_quote_token_account: ctx.accounts.bonding_curve_quote.to_account_info(),
                user_pool_token_account: ctx.accounts.bonding_curve_lp.to_account_info(),
                locked_lp_token_account: ctx.accounts.locked_lp_token_account.to_account_info(),
                pool_base_token_account: ctx.accounts.pool_base_token_account.to_account_info(),
                pool_quote_token_account: ctx.accounts.pool_quote_token_account.to_account_info(),
                coin_creator_vault_authority: ctx.accounts.coin_creator_vault_authority.to_account_info(),
                coin_creator_vault_ata: ctx.accounts.coin_creator_vault_ata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                base_token_program: ctx.accounts.token_program.to_account_info(),
                quote_token_program: ctx.accounts.quote_token_program.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx.accounts.amm_event_authority.to_account_info(),
                program: ctx.accounts.amm_program.to_account_info(),
            },
            bc_signer,
        ),
        0,
        base_amount,
        quote_amount,
        bc.creator,
    )?;

    // 3. burn the LP and close the helper accounts
    let lp_amount = {
        let data = ctx.accounts.bonding_curve_lp.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut &data[..])?.amount
    };
    if lp_amount > 0 {
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn { mint: ctx.accounts.lp_mint.to_account_info(), from: ctx.accounts.bonding_curve_lp.to_account_info(), authority: bc_info.clone() },
                bc_signer,
            ),
            lp_amount,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount { account: ctx.accounts.bonding_curve_lp.to_account_info(), destination: ctx.accounts.user.to_account_info(), authority: bc_info.clone() },
        bc_signer,
    ))?;
    ti::close_account(CpiContext::new_with_signer(
        ctx.accounts.quote_token_program.to_account_info(),
        ti::CloseAccount { account: ctx.accounts.bonding_curve_quote.to_account_info(), destination: ctx.accounts.user.to_account_info(), authority: bc_info.clone() },
        bc_signer,
    ))?;

    let bc = &mut ctx.accounts.bonding_curve;
    bc.migrated = true;
    bc.real_sol_reserves = 0;
    emit_cpi!(MigrateEvent {
        mint: bc.mint, bonding_curve: bc.key(), pool: ctx.accounts.pool.key(), user: ctx.accounts.user.key(),
        base_amount, quote_amount, migration_fee: fee, lp_burned: lp_amount, timestamp: Clock::get()?.unix_timestamp, quote_mint: bc.quote_mint,
    });
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[event_cpi]
#[derive(Accounts)]
pub struct SetQuoteConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump, has_one = authority @ CurveError::Unauthorized)]
    pub global: Account<'info, Global>,
    pub quote_mint: InterfaceAccount<'info, MintI>,
    #[account(init_if_needed, payer = authority, space = 8 + QuoteConfig::INIT_SPACE, seeds = [QUOTE_CONFIG_SEED, quote_mint.key().as_ref()], bump)]
    pub quote_config: Account<'info, QuoteConfig>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateV2<'info> {
    #[account(init, payer = user, mint::decimals = TOKEN_DECIMALS, mint::authority = mint_authority)]
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA, only ever used as a signer.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(init, payer = user, space = 8 + BondingCurve::INIT_SPACE, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(init, payer = user, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Box<Account<'info, TokenAccount>>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(seeds = [QUOTE_CONFIG_SEED, quote_mint.key().as_ref()], bump = quote_config.bump)]
    pub quote_config: Box<Account<'info, QuoteConfig>>,
    #[account(init, payer = user, associated_token::mint = quote_mint, associated_token::authority = bonding_curve, associated_token::token_program = quote_token_program)]
    pub bonding_curve_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    pub mpl_token_metadata: Program<'info, Metadata>,
    /// CHECK: validated by the Metaplex program.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TradeV2<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = quote_mint @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = user, associated_token::mint = mint, associated_token::authority = user)]
    pub associated_user: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(mut, token::mint = quote_mint, token::authority = user, token::token_program = quote_token_program)]
    pub user_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = bonding_curve, associated_token::token_program = quote_token_program)]
    pub bonding_curve_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(init_if_needed, payer = user, associated_token::mint = quote_mint, associated_token::authority = fee_recipient, associated_token::token_program = quote_token_program)]
    pub fee_recipient_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    /// CHECK: creator vault PDA (same PDA that holds SOL fees); authority of the quote ATA below.
    #[account(seeds = [CREATOR_VAULT_SEED, bonding_curve.creator.as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = user, associated_token::mint = quote_mint, associated_token::authority = creator_vault, associated_token::token_program = quote_token_program)]
    pub creator_vault_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// Optional: the fees program's tiered schedule.
    #[account(seeds = [openpump_fee_types::FEE_CONFIG_SEED], bump = fee_config.bump, seeds::program = openpump_fee_types::FEES_PROGRAM_ID)]
    pub fee_config: Option<Box<Account<'info, openpump_fee_types::FeeConfig>>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct CollectCreatorFeeV2<'info> {
    /// Pays for the creator's ATA if missing.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: receives its own vault; permissionless.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    /// CHECK: creator vault PDA.
    #[account(seeds = [CREATOR_VAULT_SEED, creator.key().as_ref()], bump)]
    pub creator_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = creator_vault, associated_token::token_program = quote_token_program)]
    pub creator_vault_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(init_if_needed, payer = payer, associated_token::mint = quote_mint, associated_token::authority = creator, associated_token::token_program = quote_token_program)]
    pub creator_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct MigrateV2<'info> {
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    /// CHECK: must equal the configured protocol fee recipient.
    #[account(address = global.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = user, associated_token::mint = quote_mint, associated_token::authority = fee_recipient, associated_token::token_program = quote_token_program)]
    pub fee_recipient_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint, has_one = quote_mint @ CurveError::WrongQuoteMint)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub associated_bonding_curve: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = bonding_curve, associated_token::token_program = quote_token_program)]
    pub bonding_curve_quote: Box<InterfaceAccount<'info, TokenAccountI>>,
    /// CHECK: curve-owned LP ATA, created by the AMM CPI and closed at the end.
    #[account(mut)]
    pub bonding_curve_lp: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub quote_mint: Box<InterfaceAccount<'info, MintI>>,
    #[account(seeds = [QUOTE_CONFIG_SEED, quote_mint.key().as_ref()], bump = quote_config.bump)]
    pub quote_config: Box<Account<'info, QuoteConfig>>,

    #[account(address = global.amm_program)]
    pub amm_program: Program<'info, OpenpumpAmm>,
    /// CHECK: AMM global config PDA.
    pub amm_global_config: UncheckedAccount<'info>,
    /// CHECK: pool PDA, initialised by the AMM.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: LP mint PDA, initialised by the AMM.
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub locked_lp_token_account: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub pool_base_token_account: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub pool_quote_token_account: UncheckedAccount<'info>,
    /// CHECK: AMM PDA for the coin creator's vault.
    pub coin_creator_vault_authority: UncheckedAccount<'info>,
    /// CHECK: initialised by the AMM.
    #[account(mut)]
    pub coin_creator_vault_ata: UncheckedAccount<'info>,
    /// CHECK: AMM event authority PDA.
    pub amm_event_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
