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
  fn update(&mut self, root: [u8; 32]) -> Result<()> {
    self.campaign.merkle_root = root;
    Ok(())
  }

  fn resize(&mut self) -> Result<()> {
    let curr_bitmap_length = self.campaign.bit_map.len();
    let new_bitmap_length = curr_bitmap_length * 2;
    let new_account_size = 32 + 32 + 8 + 32 + 24 + new_bitmap_length + CampaignState::DISCRIMINATOR.len();
    let current_lamports = self.campaign.to_account_info().lamports();
    let new_rent_exempt = Rent::get()?.minimum_balance(new_account_size);
    if new_rent_exempt > current_lamports {
      let diff = new_rent_exempt - current_lamports;
      system_program::transfer(
        CpiContext::new(
          self.system_program.to_account_info(),
          system_program::Transfer {
            from: self.distributor.to_account_info(),
            to: self.campaign.to_account_info(),
          },
        ),
        diff
      )?;
    }
    self.campaign.bit_map.resize(new_bitmap_length, 0u8);
    Ok(())
  }

}

// TODO: Update distributor key to a valid fixed address
pub fn handler(ctx: Context<Update>, root: [u8; 32], flag: bool) -> Result<()> {
  require_eq!(ctx.accounts.distributor.key(), Pubkey::from_str_const("5PpeUwd8XqJ4y75gEM3ATrmaV4piR9GdZhpuFhH76UGw"), CommiError::InvalidDistributor);
  if flag {
    ctx.accounts.resize()?;
  }
  ctx.accounts.update(root)?;
  emit!(UpdateEvent {
    campaign: ctx.accounts.campaign.key(),
    root,
  });
  Ok(())
}






