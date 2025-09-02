use anchor_lang::{prelude::*, system_program};
use anchor_spl::token_interface::Mint;
use crate::state::CampaignState;
use crate::errors::CommiError;
use crate::events::UpdateEvent;

#[derive(Accounts)]
pub struct Update<'info> {
  #[account(mut)]
  pub distributor: Signer<'info>,

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
  pub system_program: Program<'info, System>,
}

impl<'info> Update<'info> {
  fn update(&mut self, root: [u8; 32], participants: Vec<[u64; 2]>) -> Result<()> {
    for participant in participants {
      self.campaign.rewards[participant[0] as usize] += participant[1];
    }
    self.campaign.merkle_root = root;
    Ok(())
  }
}

// TODO: Update distributor key to a valid fixed address
pub fn handler(ctx: Context<Update>, root: [u8; 32], participants: Vec<[u64; 2]>) -> Result<()> {
  require_eq!(ctx.accounts.distributor.key(), Pubkey::from_str_const("5PpeUwd8XqJ4y75gEM3ATrmaV4piR9GdZhpuFhH76UGw"), CommiError::InvalidDistributor);
  ctx.accounts.update(root, participants)?;
  emit!(UpdateEvent {
    campaign: ctx.accounts.campaign.key(),
    root,
  });
  Ok(())
}






