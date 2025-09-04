use anchor_lang::prelude::*;

#[account(discriminator = 1)]
pub struct CampaignState {
  pub launcher: Pubkey,
  pub mint: Pubkey,
  pub fund: u64,
  pub locked: u8, 
  pub merkle_root: [u8; 32],
  pub rewards: Vec<u64>,
}
