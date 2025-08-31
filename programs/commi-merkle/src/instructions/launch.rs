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
#[instruction(seed: u64)]
pub struct Launch<'info> {
  #[account(mut)]
  pub launcher: Signer<'info>,
  
  #[account(
    init,
    payer = launcher,
    // Allocate 31 participants + 1 funder at the beginning
    space = 32 + 1 + 8 + 8 + 32 + 24 + 4 + CampaignState::DISCRIMINATOR.len(), 
    seeds = [b"champaign", launcher.key().as_ref(), seed.to_le_bytes().as_ref()],
    bump,
  )]
  pub campaign: Account<'info, CampaignState>,
  
  #[account(
    mint::token_program = token_program
  )]
  pub mint: Box<InterfaceAccount<'info, Mint>>,

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
  fn populate_campaign(&mut self, seed: u64, fund: u64, bump: u8) -> Result<()> {
    self.campaign.set_inner(CampaignState {
      merkle_root: [0; 32],
      mint: self.mint.key(),
      fund,
      bit_map: vec![0u8; 4],
      bump,
      seed,
    });
    Ok(())
  }

  fn deposit_tokens(&self, fund: u64) -> Result<()> {
    transfer_checked(
      CpiContext::new(
        self.token_program.to_account_info(),
        TransferChecked {
          from: self.launcher.to_account_info(),
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

pub fn handler(ctx: Context<Launch>, seed: u64, fund: u64) -> Result<()> {
  require_gt!(fund, 0, CommiError::InvalidFund);
  ctx.accounts.populate_campaign(seed, fund, ctx.bumps.campaign)?;
  ctx.accounts.deposit_tokens(fund)?;
  emit!(LaunchEvent { 
    launcher: ctx.accounts.launcher.key(), 
    fund, 
    mint:  ctx.accounts.mint.key(),
  });
  Ok(())
}