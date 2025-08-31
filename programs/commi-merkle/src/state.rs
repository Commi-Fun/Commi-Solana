use anchor_lang::prelude::*;

#[account(discriminator = 1)]
pub struct CampaignState {
  pub launcher: Pubkey,
  pub mint: Pubkey,
  pub fund: u64,
  pub merkle_root: [u8; 32],
  pub bit_map: Vec<u8>,
}
