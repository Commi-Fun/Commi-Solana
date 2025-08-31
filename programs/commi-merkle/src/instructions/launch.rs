use anchor_lang::prelude::*;
use anchor_lang::context::Context;
use anchor_spl::{
  associated_token::AssociatedToken, 
  token::{transfer_checked, TransferChecked}, 
  token_interface::{Mint, TokenAccount, TokenInterface}
};
use crate::state::CampaignState;
use crate::errors::CommiError;
use crate::events::LaunchEvent;

#[derive(Accounts)]
pub struct Launch<'info> {
  #[account(mut)]
  pub launcher: Signer<'info>,
  
  #[account(
    init,
    payer = launcher,
    // Allocate 31 participants + 1 funder at the beginning
    space = 32 + 32 + 8 + 32 + 24 + 4 + CampaignState::DISCRIMINATOR.len(), 
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
  
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
}

impl<'info> Launch<'info> {
  fn populate_campaign(&mut self, fund: u64, root: [u8; 32]) -> Result<()> {
    self.campaign.set_inner(CampaignState {
      merkle_root: root,
      launcher: self.launcher.key(),
      mint: self.mint.key(),
      fund,
      bit_map: vec![0u8; 4],
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
  ctx.accounts.populate_campaign(fund, root)?;
  ctx.accounts.deposit_tokens(fund)?;
  emit!(LaunchEvent { 
    launcher: ctx.accounts.launcher.key(), 
    fund, 
    mint:  ctx.accounts.mint.key(),
  });
  Ok(())
}