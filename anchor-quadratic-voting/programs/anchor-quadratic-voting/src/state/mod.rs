use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Dao {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub proposal_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub authority: Pubkey,
    #[max_len(200)]
    pub metadata: String,
    pub yes_vote_count: u64,
    pub no_vote_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Vote {
    pub authority: Pubkey,
    pub vote_type: u8, // 0 = no, 1 = yes
    pub credits: u64,
    pub bump: u8,
}
