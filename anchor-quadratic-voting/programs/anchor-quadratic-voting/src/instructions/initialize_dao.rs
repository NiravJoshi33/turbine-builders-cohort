use anchor_lang::prelude::*;

use crate::state::Dao;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeDao<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Dao::INIT_SPACE,
        seeds = [b"dao", creator.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub dao: Account<'info, Dao>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeDao<'info> {
    pub fn initialize_dao(&mut self, name: String, bumps: &InitializeDaoBumps) -> Result<()> {
        self.dao.set_inner(Dao {
            authority: self.creator.key(),
            name,
            proposal_count: 0,
            bump: bumps.dao,
        });
        Ok(())
    }
}
