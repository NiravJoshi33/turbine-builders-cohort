pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("CHnjujUg224pkvas8mpzX1rrLDVDGka1TyCyKNBE5A9T");

#[program]
pub mod anchor_quadratic_voting {
    use super::*;

    pub fn initialize_dao(ctx: Context<InitializeDao>, name: String) -> Result<()> {
        ctx.accounts.initialize_dao(name, &ctx.bumps)
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, metadata: String) -> Result<()> {
        ctx.accounts.create_proposal(metadata, &ctx.bumps)
    }

    pub fn vote(ctx: Context<CastVote>, vote_type: u8) -> Result<()> {
        ctx.accounts.vote(vote_type, &ctx.bumps)
    }
}
