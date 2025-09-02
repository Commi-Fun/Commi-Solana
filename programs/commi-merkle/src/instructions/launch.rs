use anchor_lang::{prelude::*, system_program};
use anchor_lang::context::Context;
use anchor_spl::{
  associated_token::AssociatedToken, 
  token::{transfer_checked, TransferChecked}, 
  token_interface::{Mint, TokenAccount, TokenInterface}
};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
use crate::state::CampaignState;
use crate::errors::CommiError;
use crate::events::LaunchEvent;

#[derive(Accounts)]
pub struct Launch<'info> {
  #[account(mut)]
  pub launcher: Signer<'info>,

  #[account(mut)]
  pub distributor: SystemAccount<'info>,
  
  #[account(
    init,
    payer = launcher,
    // Allocate 31 participants + 1 funder at the beginning
    space = 32 + 32 + 8 + 32 + 24 + 32 * 8 + CampaignState::DISCRIMINATOR.len(), 
    seeds = [b"campaign", launcher.key().as_ref(), mint.key().as_ref()],
    bump,
  )]
  pub campaign: Account<'info, CampaignState>,
  
  #[account(
    mint::token_program = token_program
  )]
  pub mint: Box<InterfaceAccount<'info, Mint>>,

  #[account(
    mut,
    associated_token::mint = mint,
    associated_token::authority = launcher,
    associated_token::token_program = token_program
  )]
  pub launcher_ata: InterfaceAccount<'info, TokenAccount>,

  #[account(
    init,
    payer = launcher,
    associated_token::mint = mint,
    associated_token::authority = campaign,
    associated_token::token_program = token_program,
  )]
  pub vault: InterfaceAccount<'info, TokenAccount>,
  
  #[account(mut)]
  pub price_update: Account<'info, PriceUpdateV2>,

  pub associated_token_program: Program<'info, AssociatedToken>,
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
}

pub const MAXIMUM_AGE: u64 = 60;
pub const FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"; // SOL/USD price feed id from https://pyth.network/developers/price-feed-ids

impl<'info> Launch<'info> {

  fn service_fee_calculation(&mut self) -> Result<u64> {
    let price_update = &self.price_update;
    let price = price_update.get_price_no_older_than(
      &Clock::get()?,
      MAXIMUM_AGE,
      &get_feed_id_from_hex(FEED_ID)?,
    )?;
    let service_fee_in_usd = 5_f64;
    let service_fee_in_lamports = 
      (service_fee_in_usd / ((price.price.abs() as f64) * 10f64.powi(price.exponent)) * 1_000_000_000_f64).round() as u64; 
    Ok(service_fee_in_lamports)
  }

  fn transfer_service_fee(&self, service_fee: u64) -> Result<()> {
    let launcher_lamports = self.launcher.lamports();
    if launcher_lamports < service_fee {
      return err!(CommiError::InsufficientBalance);
    }

    system_program::transfer(
  CpiContext::new(
        self.system_program.to_account_info(),
        system_program::Transfer {
          from: self.launcher.to_account_info(),
          to: self.distributor.to_account_info(),
        },
      ),
      service_fee
    )?;
    Ok(())
  }

  fn populate_campaign(&mut self, fund: u64, root: [u8; 32]) -> Result<()> {
    let mut rewards = vec![0u64; 32];
    rewards[0] = fund;
    self.campaign.set_inner(CampaignState {
      merkle_root: root,
      launcher: self.launcher.key(),
      mint: self.mint.key(),
      fund,
      rewards,
    });
    Ok(())
  }

  fn deposit_tokens(&self, fund: u64) -> Result<()> {
    transfer_checked(
      CpiContext::new(
        self.token_program.to_account_info(),
        TransferChecked {
          from: self.launcher_ata.to_account_info(),
          mint: self.mint.to_account_info(),
          to: self.vault.to_account_info(),
          authority: self.launcher.to_account_info(),
        },
      ),
      fund, 
      self.mint.decimals
    )?;
    Ok(())
  }

}

pub fn handler(ctx: Context<Launch>, fund: u64, root: [u8; 32]) -> Result<()> {
  require_gt!(fund, 0, CommiError::InvalidFund);
  require_eq!(ctx.accounts.distributor.key(), Pubkey::from_str_const("5PpeUwd8XqJ4y75gEM3ATrmaV4piR9GdZhpuFhH76UGw"), CommiError::InvalidDistributor);
  let service_fee = ctx.accounts.service_fee_calculation()?;
  ctx.accounts.transfer_service_fee(service_fee)?;
  ctx.accounts.populate_campaign(fund, root)?;
  ctx.accounts.deposit_tokens(fund)?;
  emit!(LaunchEvent { 
    launcher: ctx.accounts.launcher.key(), 
    fund, 
    mint:  ctx.accounts.mint.key(),
  });
  Ok(())
}