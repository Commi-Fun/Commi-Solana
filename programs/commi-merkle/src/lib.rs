use anchor_lang::prelude::*;

mod errors;
mod events;
mod instructions;
mod state;

use instructions::*;

declare_id!("4BY7rXDgtbkgjAY1acpy3Pfg7hXhZf1vpFNtfVreSJHL");

#[program]
pub mod commi_merkle {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn launch(ctx: Context<Launch>, seed: u64, fund: u64) -> Result<()> {
        instructions::launch::handler(ctx, seed, fund)
    }

    #[instruction(discriminator = 1)]
    pub fn update(ctx: Context<Update>, root: [u8; 32], participants: Vec<[u64; 2]>) -> Result<()> {
        instructions::update::handler(ctx, root, participants)
    }

    #[instruction(discriminator = 2)]
    pub fn claim(ctx: Context<Claim>, user_idx: u64, proof: Vec<[u8; 32]>, nonce: u64) -> Result<()> {
        instructions::claim::handler(ctx, user_idx, proof, nonce)
    }

    #[instruction(discriminator = 3)]
    pub fn extend(ctx: Context<Extend>, new_participants: u64) -> Result<()> {
        instructions::extend::handler(ctx, new_participants)
    }

    #[instruction(discriminator = 4)]
    pub fn lock(ctx: Context<Update>) -> Result<()> {
        instructions::update::lock(ctx)
    }
}

