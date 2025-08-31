use anchor_lang::prelude::*;

#[account(discriminator = 1)]
pub struct CampaignState {
  pub mint: Pubkey,
  pub bump: u8,
  pub seed: u64,
  pub fund: u64,
  pub merkle_root: [u8; 32],
  pub bit_map: Vec<u8>,
}

