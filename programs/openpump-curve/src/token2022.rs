//! Token-2022 coins (pump.fun's `create_v2` mint path): the mint carries its own metadata through
//! the MetadataPointer + TokenMetadata extensions, no Metaplex account. Update authority is
//! removed and the mint authority revoked, so name/symbol/uri and supply are immutable.
//! Quote is native SOL; trading, graduation and the AMM accept either token program for the coin.

use crate::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_2022_extensions::token_metadata::{token_metadata_initialize, token_metadata_update_authority, TokenMetadataInitialize, TokenMetadataUpdateAuthority};
use anchor_spl::token_interface::{self as ti, Mint as MintI, TokenAccount as TokenAccountI};
use anchor_spl::token_interface::spl_pod::optional_keys::OptionalNonZeroPubkey;

pub fn create_v3(ctx: Context<CreateV3>, name: String, symbol: String, uri: String, is_holder_reward: bool, creator: Pubkey) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, CurveError::Paused);
    require!(!is_holder_reward || g.holder_reward_enabled, CurveError::HolderRewardDisabled);
    require!(name.len() <= 32 && symbol.len() <= 10 && uri.len() <= 200, CurveError::MetadataTooLong);

    let seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]];
    let signer: &[&[&[u8]]] = &[seeds];
    let mint_info = ctx.accounts.mint.to_account_info();

    // The TokenMetadata TLV grows the mint account: fund the rent delta first.
    let metadata_len = 4 + 32 + 32 + (4 + name.len()) + (4 + symbol.len()) + (4 + uri.len()) + 4;
    let needed = Rent::get()?.minimum_balance(mint_info.data_len() + metadata_len).saturating_sub(mint_info.lamports());
    if needed > 0 {
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer { from: ctx.accounts.user.to_account_info(), to: mint_info.clone() }),
            needed,
        )?;
    }
    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                mint: mint_info.clone(),
                metadata: mint_info.clone(),
                mint_authority: ctx.accounts.mint_authority.to_account_info(),
                update_authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer,
        ),
        name.clone(),
        symbol.clone(),
        uri.clone(),
    )?;
    // metadata immutable: drop the update authority
    token_metadata_update_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataUpdateAuthority {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: mint_info.clone(),
                current_authority: ctx.accounts.mint_authority.to_account_info(),
                new_authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer,
        ),
        OptionalNonZeroPubkey::default(),
    )?;
    ti::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            ti::MintTo { mint: mint_info.clone(), to: ctx.accounts.associated_bonding_curve.to_account_info(), authority: ctx.accounts.mint_authority.to_account_info() },
            signer,
        ),
        g.token_total_supply,
    )?;
    ti::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            ti::SetAuthority { current_authority: ctx.accounts.mint_authority.to_account_info(), account_or_mint: mint_info.clone() },
            signer,
        ),
        anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType::MintTokens,
        None,
    )?;

    let clock = Clock::get()?;
    let bc = &mut ctx.accounts.bonding_curve;
    bc.mint = ctx.accounts.mint.key();
    bc.creator = if is_holder_reward { holder_rewards_pda(&bc.mint) } else if creator == Pubkey::default() { ctx.accounts.user.key() } else { creator };
    bc.is_holder_reward = is_holder_reward;
    bc.creator_fee_bps = 0;
    bc.can_edit_creator_fee = !is_holder_reward;
    bc.virtual_token_reserves = g.initial_virtual_token_reserves;
    bc.virtual_sol_reserves = g.initial_virtual_sol_reserves;
    bc.real_token_reserves = g.initial_real_token_reserves;
    bc.real_sol_reserves = 0;
    bc.token_total_supply = g.token_total_supply;
    bc.complete = false;
    bc.migrated = false;
    bc.created_slot = clock.slot;
    bc.creator_fees_total = 0;
    bc.protocol_fees_total = 0;
    bc.bump = ctx.bumps.bonding_curve;
    bc.quote_mint = Pubkey::default();

    emit_cpi!(CreateEvent {
        name, symbol, uri,
        mint: bc.mint, bonding_curve: bc.key(), user: ctx.accounts.user.key(), creator: bc.creator,
        virtual_token_reserves: bc.virtual_token_reserves, virtual_sol_reserves: bc.virtual_sol_reserves,
        real_token_reserves: bc.real_token_reserves, token_total_supply: bc.token_total_supply,
        timestamp: clock.unix_timestamp, quote_mint: bc.quote_mint, is_holder_reward: bc.is_holder_reward,
        token_program: ctx.accounts.token_program.key(),
        });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateV3<'info> {
    #[account(
        init,
        payer = user,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint_authority,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = mint_authority,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, MintI>>,
    /// CHECK: PDA, only ever used as a signer.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(init, payer = user, space = 8 + BondingCurve::INIT_SPACE, seeds = [BONDING_CURVE_SEED, mint.key().as_ref()], bump)]
    pub bonding_curve: Box<Account<'info, BondingCurve>>,
    #[account(init, payer = user, associated_token::mint = mint, associated_token::authority = bonding_curve, associated_token::token_program = token_program)]
    pub associated_bonding_curve: Box<InterfaceAccount<'info, TokenAccountI>>,
    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Box<Account<'info, Global>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
