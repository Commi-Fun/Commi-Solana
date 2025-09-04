use anchor_lang::prelude::*;


#[event]
pub struct LaunchEvent {
  pub fund: u64,
  pub launcher: Pubkey,
  pub mint: Pubkey,
}

#[event]
pub struct UpdateEvent {
  pub campaign: Pubkey,
  pub root: [u8; 32]
}

#[event]
pub struct ClaimEvent {
  pub claimer: Pubkey,
  pub campaign: Pubkey,
  pub amount: u64,
}

#[event]
pub struct ExtendEvent {
  pub size: u64
}