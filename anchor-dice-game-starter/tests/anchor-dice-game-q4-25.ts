import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorDiceGameQ425 } from "../target/types/anchor_dice_game_q4_25";
import { PublicKey, Ed25519Program, Keypair, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";

describe("anchor-dice-game-q4-25", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorDiceGameQ425 as Program<AnchorDiceGameQ425>;
  const connection = provider.connection;

  const house = provider.wallet as anchor.Wallet;
  const player = Keypair.generate();

  // derive vault pda
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), house.publicKey.toBuffer()],
    program.programId
  );

  const seed = new anchor.BN(12345); // u128 seed for the bet

  // derive bet pda - need to match the seeds in place_bet.rs
  const [betPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("bet"),
      vault.toBuffer(),
      seed.toArrayLike(Buffer, "le", 16), // u128 = 16 bytes little endian
    ],
    program.programId
  );

  before(async () => {
    // airdrop some sol to player so they can bet
    const sig = await connection.requestAirdrop(
      player.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);
  });

  it("Initialize", async () => {
    const amount = new anchor.BN(5 * anchor.web3.LAMPORTS_PER_SOL);

    const tx = await program.methods
      .initialize(amount)
      .accountsPartial({
        house: house.publicKey,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("init tx:", tx);

    const vaultBalance = await connection.getBalance(vault);
    console.log("vault balance:", vaultBalance / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    expect(vaultBalance).to.equal(5 * anchor.web3.LAMPORTS_PER_SOL);
  });

  it("Place bet", async () => {
    const roll = 50; // 49% chance of winning
    const amount = new anchor.BN(0.1 * anchor.web3.LAMPORTS_PER_SOL);

    const tx = await program.methods
      .placeBet(seed, roll, amount)
      .accountsPartial({
        player: player.publicKey,
        house: house.publicKey,
        vault,
        bet: betPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
    console.log("place bet tx:", tx);

    // check the bet account got created correctly
    const betAccount = await program.account.bet.fetch(betPda);
    console.log("bet account:", {
      player: betAccount.player.toBase58(),
      roll: betAccount.roll,
      amount: betAccount.amount.toNumber(),
      slot: betAccount.slot.toNumber(),
    });

    expect(betAccount.player.toBase58()).to.equal(player.publicKey.toBase58());
    expect(betAccount.roll).to.equal(roll);
    expect(betAccount.amount.toNumber()).to.equal(0.1 * anchor.web3.LAMPORTS_PER_SOL);
  });

  it("Resolve bet", async () => {
    // fetch the bet account data from chain
    const betAccountInfo = await connection.getAccountInfo(betPda);
    // skip the 8 byte anchor discriminator to get the raw bet struct
    const betData = betAccountInfo.data.slice(8);

    // sign the bet data with house key using ed25519
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: house.payer.secretKey,
      message: betData,
    });

    // pull out the 64 byte signature from the ed25519 instruction
    // data layout: [num_sigs(1), padding(1), sig_offset(u16), ...]
    const sigOffset = ed25519Ix.data.readUInt16LE(2);
    const sig = ed25519Ix.data.slice(sigOffset, sigOffset + 64);

    // need to send ed25519 verify as first ix (index 0) and resolve_bet as second (index 1)
    // our program introspects index 0 to check the signature
    const tx = await program.methods
      .resolveBet(Buffer.from(sig))
      .accountsPartial({
        house: house.publicKey,
        player: player.publicKey,
        vault,
        bet: betPda,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .rpc();
    console.log("resolve bet tx:", tx);

    // bet should be closed now
    const closedBet = await connection.getAccountInfo(betPda);
    expect(closedBet).to.be.null;
    console.log("bet account closed successfully");
  });

  it("Refund bet", async () => {
    // need a new bet to test refund
    const refundSeed = new anchor.BN(99999);
    const [refundBetPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bet"),
        vault.toBuffer(),
        refundSeed.toArrayLike(Buffer, "le", 16),
      ],
      program.programId
    );

    const amount = new anchor.BN(0.05 * anchor.web3.LAMPORTS_PER_SOL);

    await program.methods
      .placeBet(refundSeed, 50, amount)
      .accountsPartial({
        player: player.publicKey,
        house: house.publicKey,
        vault,
        bet: refundBetPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    // cant warp 1000 slots on localnet so this should fail with TimeoutNotReached
    try {
      await program.methods
        .refundBet()
        .accountsPartial({
          player: player.publicKey,
          house: house.publicKey,
          vault,
          bet: refundBetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      console.log("refund went through");
    } catch (e) {
      console.log("refund rejected (expected - timeout not reached)");
      expect(e.message).to.include("TimeoutNotReached");
    }
  });
});
