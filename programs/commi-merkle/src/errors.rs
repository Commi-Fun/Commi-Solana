use anchor_lang::prelude::*;

#[error_code]
pub enum CommiError {
  
  // Launch Error
  #[msg("Insufficient Balance")]
  InsufficientBalance,

  #[msg("Invalid Fund")]
  InvalidFund,

  #[msg("Invalid Price Feed Account")]
  InvalidPriceFeed,

  // Update Error
  #[msg("Invalid Update Amount")]
  InvalidUpdateAmount,

  #[msg("Insufficient Fund to Allocate")]
  InsufficientAllocation,

  // Claim Error
  #[msg("Invalid Proof")]
  InvalidProof,

  #[msg("Invalid Claim Amount")]
  InvalidClaimAmount,

  #[msg("Invalid User Idx")]
  InvalidUserIdx,

  #[msg("Campaign Locked")]
  CampaignLocked,

  // Shared Error
  #[msg("Invalid Distributor")]
  InvalidDistributor,

  #[msg("Invaid Mint")]
  InvalidMint,

  #[msg("Invaid Launcher")]
  InvalidLauncher,

}