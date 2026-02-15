use anchor_lang::prelude::*;

#[error_code]
pub enum VotingError {
    #[msg("Invalid vote type")]
    InvalidVoteType,
    #[msg("Insufficient token balance")]
    InsufficientBalance,
}
