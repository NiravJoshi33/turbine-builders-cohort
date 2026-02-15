use anchor_lang::prelude::*;

use crate::state::{Dao, Proposal};

#[derive(Accounts)]
#[instruction(metadata: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"dao", dao.authority.as_ref(), dao.name.as_bytes()],
        bump = dao.bump,
    )]
    pub dao: Account<'info, Dao>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", dao.key().as_ref(), dao.proposal_count.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    pub system_program: Program<'info, System>,
}

impl<'info> CreateProposal<'info> {
    pub fn create_proposal(&mut self, metadata: String, bumps: &CreateProposalBumps) -> Result<()> {
        self.proposal.set_inner(Proposal {
            authority: self.proposer.key(),
            metadata,
            yes_vote_count: 0,
            no_vote_count: 0,
            bump: bumps.proposal,
        });

        // increment dao proposal count
        self.dao.proposal_count += 1;

        Ok(())
    }
}
