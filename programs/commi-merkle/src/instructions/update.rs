use anchor_lang::prelude::*;
use anchor_spl::{
  associated_token::AssociatedToken, 
  token::{transfer_checked, TransferChecked}, 
  token_interface::{Mint, TokenAccount, TokenInterface}
};
use crate::state::CampaignState;
use crate::errors::CommiError;


#[derive(Accounts)]
pub struct Update<'info> {
  #[account(mut)]
  pub distributor: Signer<'info>,

  #[account(mut)]
  pub launcher: SystemAccount<'info>,

  #[account(
    mut,
    seeds = [b"campaign", launcher.key().as_ref(), campaign.seed.to_le_bytes().as_ref()],
    bump = campaign.bump,
    has_one = mint @ CommiError::InvalidMint
  )]
  pub campaign: Account<'info, CampaignState>,
  pub mint: Box<InterfaceAccount<'info, Mint>>,
}

impl<'info> Update<'info> {
  fn update(&mut self, root: [u8; 32]) -> Result<()> {
    self.campaign.merkle_root = root;
    Ok(())
  }
}

// TODO: Update distributor key to a valid fixed address
pub fn handler(ctx: Context<Update>, root: [u8; 32]) -> Result<()> {
  require_eq!(ctx.accounts.distributor.key(), Pubkey::from_str_const("22222222222222222222222222222222222222222222"), CommiError::InvalidDistributor);
  ctx.accounts.update(root)
}






