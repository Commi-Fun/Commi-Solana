use anchor_lang::prelude::*;

#[error_code]
pub enum CommiError {

  #[msg("Insufficient Balance")]
  InsufficientBalance,

  #[msg("Invalid Fund")]
  InvalidFund,

  #[msg("Invaid Mint")]
  InvalidMint,

  #[msg("Invaid Launcher")]
  InvalidLauncher,

  #[msg("Invalid Distributor")]
  InvalidDistributor,

  #[msg("Already Claimed")]
  AlreadyClaimed,

  #[msg("Invalid Proof")]
  InvalidProof,

  #[msg("Invalid Amount")]
  InvalidAmount,

  #[msg("Invalid User Idx")]
  InvalidUserIdx,

}