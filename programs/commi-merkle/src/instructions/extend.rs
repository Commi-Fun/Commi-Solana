use anchor_lang::prelude::*;
use crate::state::CampaignState;
use crate::errors::CommiError;
use crate::events::ExtendEvent;

#[derive(Accounts)]
#[instruction(new_participants: u64)]
pub struct Extend<'info> {
  #[account(mut)]
  pub distributor: Signer<'info>,
  #[account(
    mut,
    realloc = 32 + 32 + 8 + 1 + 32 + 24 + new_participants as usize * 8 + CampaignState::DISCRIMINATOR.len(), 
    realloc::payer = distributor,    
    realloc::zero = false,
  )]
  pub campaign: Account<'info, CampaignState>,
  pub system_program: Program<'info, System>,
}

impl<'info> Extend<'info> {
  fn extend(&mut self, new_participants: u64) -> Result<()> {
    self.campaign.rewards.resize(new_participants as usize, 0u64);
    Ok(())
  }
}

pub fn handler(ctx: Context<Extend>, new_participants: u64) -> Result<()> {
  require_eq!(ctx.accounts.distributor.key(), Pubkey::from_str_const("5PpeUwd8XqJ4y75gEM3ATrmaV4piR9GdZhpuFhH76UGw"), CommiError::InvalidDistributor);
  ctx.accounts.extend(new_participants)?;
  emit!(ExtendEvent {
    size: new_participants,
  });
  Ok(())
}
