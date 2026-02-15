use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_instruction_sysvar::Ed25519InstructionSignatures;
use solana_program::sysvar::instructions::load_instruction_at_checked;

use crate::{errors::DiceError, state::Bet};

#[derive(Accounts)]
pub struct ResolveBet<'info> {
    #[account(mut)]
    pub house: Signer<'info>,
    ///CHECK: this is checked via has_one on bet
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", house.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        close = player,
        has_one = player,
        seeds = [b"bet", vault.key().as_ref(), bet.seed.to_le_bytes().as_ref()],
        bump = bet.bump
    )]
    pub bet: Account<'info, Bet>,
    ///CHECK: this is the instructions sysvar
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> ResolveBet<'info> {
    pub fn verify_ed25519_signature(&self, sig: &[u8]) -> Result<()> {
        // grab the ed25519 instruction (should be at index 0 in our tx)
        let ix = load_instruction_at_checked(0, &self.instruction_sysvar.to_account_info())
            .map_err(|_| DiceError::Ed25519Header)?;

        // make sure its actually the ed25519 program
        require_keys_eq!(ix.program_id, solana_program::ed25519_program::ID, DiceError::Ed25519Program);

        // ed25519 ix should have no accounts
        require_eq!(ix.accounts.len(), 0, DiceError::Ed25519Accounts);

        // unpack the signature data
        let signatures = Ed25519InstructionSignatures::unpack(&ix.data)
            .map_err(|_| DiceError::Ed25519DataLength)?;

        require_eq!(signatures.0.len(), 1, DiceError::Ed25519Header);
        let signature = &signatures.0[0];

        require!(signature.is_verifiable, DiceError::Ed25519Header);

        // check that the house signed it
        require_keys_eq!(
            signature.public_key.ok_or(DiceError::Ed25519Pubkey)?,
            self.house.key(),
            DiceError::Ed25519Pubkey
        );

        // check sig matches what was passed in
        let sig_bytes: [u8; 64] = sig.try_into().map_err(|_| DiceError::Ed25519Signature)?;
        require!(
            signature.signature.ok_or(DiceError::Ed25519Signature)? == sig_bytes,
            DiceError::Ed25519Signature
        );

        // check the message is the bet account data
        require!(
            signature.message.as_ref().ok_or(DiceError::Ed25519Message)?
                == &self.bet.to_slice(),
            DiceError::Ed25519Message
        );

        Ok(())
    }

    pub fn resolve_bet(&mut self, sig: &[u8], bumps: &ResolveBetBumps) -> Result<()> {
        let hash = solana_program::hash::hash(sig);
        let hash_ref = hash.to_bytes();

        // split hash into two halves and combine for randomness
        let mut lower: [u8; 16] = [0u8; 16];
        let mut upper: [u8; 16] = [0u8; 16];
        lower.copy_from_slice(&hash_ref[0..16]);
        upper.copy_from_slice(&hash_ref[16..32]);

        let lower = u128::from_le_bytes(lower);
        let upper = u128::from_le_bytes(upper);

        // random number between 1-100
        let roll = lower
            .wrapping_add(upper)
            .wrapping_rem(100) as u8
            + 1;

        if roll <= self.bet.roll {
            // player wins - payout with 1.5% house edge (150 basis points)
            let payout = (self.bet.amount as u128)
                .checked_mul(10000 - 150).ok_or(DiceError::Overflow)?
                .checked_div((self.bet.roll as u128 - 1) * 100).ok_or(DiceError::Overflow)?
                as u64;

            let signer_seeds: &[&[&[u8]]] = &[&[
                b"vault",
                &self.house.key().to_bytes(),
                &[bumps.vault],
            ]];

            let ctx = CpiContext::new_with_signer(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.vault.to_account_info(),
                    to: self.player.to_account_info(),
                },
                signer_seeds,
            );

            transfer(ctx, payout)?;
        }
        // bet account gets closed either way (close = player)

        Ok(())
    }
}
