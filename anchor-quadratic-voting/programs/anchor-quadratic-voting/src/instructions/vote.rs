use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::VotingError;
use crate::state::{Proposal, Vote};

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + Vote::INIT_SPACE,
        seeds = [b"vote", voter.key().as_ref(), proposal.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, Vote>,
    // governance token account - just reading the balance
    #[account(
        token::authority = voter,
    )]
    pub token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

impl<'info> CastVote<'info> {
    pub fn vote(&mut self, vote_type: u8, bumps: &CastVoteBumps) -> Result<()> {
        require!(vote_type <= 1, VotingError::InvalidVoteType);
        require!(self.token_account.amount > 0, VotingError::InsufficientBalance);

        // quadratic voting: credits = sqrt(token balance)
        let balance = self.token_account.amount;
        let credits = (balance as f64).sqrt() as u64;

        match vote_type {
            0 => self.proposal.no_vote_count += credits,
            1 => self.proposal.yes_vote_count += credits,
            _ => return err!(VotingError::InvalidVoteType),
        }

        self.vote.set_inner(Vote {
            authority: self.voter.key(),
            vote_type,
            credits,
            bump: bumps.vote,
        });

        Ok(())
    }
}
