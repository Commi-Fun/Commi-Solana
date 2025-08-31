use anchor_lang::prelude::*;

#[error_code]
pub enum CommiError {
  #[msg("Invalid Fund")]
  InvalidFund,

  #[msg("Invaid Mint")]
  InvalidMint,

  #[msg("Invalid Distributor")]
  InvalidDistributor,

  #[msg("Already Claimed")]
  AlreadyClaimed,

  #[msg("Invalid Proof")]
  InvalidProof,

  #[msg("Invalid Amount")]
  InvalidAmount,

}