use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, Mint, transfer_checked, TransferChecked};
use solana_nostd_sha256::hashv;
use crate::state::CampaignState;
use crate::errors::CommiError;
use crate::events::ClaimEvent;


#[derive(Accounts)]
pub struct Claim<'info> {
  #[account(mut)]
  pub claimer: Signer<'info>,

  #[account(mut)]
  pub launcher: SystemAccount<'info>,

  #[account(
    mut,
    seeds = [b"campaign", launcher.key().as_ref(), mint.key().as_ref()],
    bump,
    has_one = mint @ CommiError::InvalidMint,
    has_one = launcher @ CommiError::InvalidLauncher
  )]
  pub campaign: Account<'info, CampaignState>,
  pub mint: Box<InterfaceAccount<'info, Mint>>,

  #[account(
    mut,
    associated_token::mint = mint,
    associated_token::authority = campaign,
    associated_token::token_program = token_program
  )]
  pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    init_if_needed,
    payer = claimer,
    associated_token::mint = mint,
    associated_token::authority = claimer,
    associated_token::token_program = token_program
  )]
  pub claimer_ata: Box<InterfaceAccount<'info, TokenAccount>>,

  pub associated_token_program: Program<'info, AssociatedToken>,
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
}

impl<'info> Claim<'info> {

  fn verify_claim_status(&self, user_idx: u16, proof: Vec<[u8; 32]>, nonce: u64) -> Result<()> {
    require_gt!(self.campaign.rewards.len(), user_idx as usize, CommiError::InvalidUserIdx);
    require_gt!(self.campaign.rewards[user_idx as usize], 0, CommiError::InvalidAmount);
    let mut leaf = hashv(&[
      self.claimer.key().to_bytes().as_ref(), 
      self.campaign.rewards[user_idx as usize].to_le_bytes().as_ref(), 
      nonce.to_le_bytes().as_ref()
    ]);
    for i in 0..proof.len() {
      let position = user_idx >> i;
      if position % 2 == 0 {
        leaf = hashv(&[leaf.as_ref(), proof[i].as_ref()]);
      } else {
        leaf = hashv(&[proof[i].as_ref(), leaf.as_ref()]);
      }
    }
    if leaf != self.campaign.merkle_root {
      return err!(CommiError::InvalidProof);
    }
    return Ok(())
  }

  fn update_status(&mut self, user_idx: u16) -> Result<()> {
    self.campaign.rewards[user_idx as usize] = 0;
    Ok(())
  }

  fn claim_tokens(&self, user_idx: u16, bump: u8) -> Result<()> {
    let launcher_key = self.launcher.key();
    let mint_key = self.mint.key();
    let signer_seeds: [&[&[u8]]; 1] = [&[
        b"campaign",
        launcher_key.as_ref(),
        mint_key.as_ref(),
        &[bump], // Use the bump from CampaignState
    ]];

    transfer_checked(
      CpiContext::new_with_signer(
        self.token_program.to_account_info(),
        TransferChecked {
          from: self.vault.to_account_info(),
          mint: self.mint.to_account_info(),
          to: self.claimer_ata.to_account_info(),
          authority: self.campaign.to_account_info(),
        },
        &signer_seeds
      ), 
      self.campaign.rewards[user_idx as usize], 
      self.mint.decimals
    )?;
    Ok(())
  }
}

pub fn handler(ctx: Context<Claim>, user_idx: u16, proof: Vec<[u8; 32]>, nonce: u64) -> Result<()> {
  ctx.accounts.verify_claim_status(user_idx, proof, nonce)?;
  ctx.accounts.claim_tokens( user_idx, ctx.bumps.campaign)?;
  ctx.accounts.update_status(user_idx)?;
  emit!(ClaimEvent {
    claimer: ctx.accounts.claimer.key(),
    campaign: ctx.accounts.campaign.key(),
  });
  Ok(())
}

