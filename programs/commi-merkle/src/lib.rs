use anchor_lang::prelude::*;

mod errors;
mod events;
mod instructions;
mod state;

use instructions::*;

declare_id!("2o9SQdKu4rrLySKkoKTuE6ZWECf4sUAUA8zjgYFynqQf");

#[program]
pub mod commi_merkle {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn launch(ctx: Context<Launch>, fund: u64, root: [u8; 32]) -> Result<()> {
        instructions::launch::handler(ctx, fund, root)
    }

    #[instruction(discriminator = 1)]
    pub fn update(ctx: Context<Update>, root: [u8; 32], flag: bool) -> Result<()> {
        instructions::update::handler(ctx, root, flag)
    }

    #[instruction(discriminator = 2)]
    pub fn claim(ctx: Context<Claim>, amount: u64, user_idx: u16, proof: Vec<[u8; 32]>, nonce: u64) -> Result<()> {
        instructions::claim::handler(ctx, amount, user_idx, proof, nonce)
    }
}

