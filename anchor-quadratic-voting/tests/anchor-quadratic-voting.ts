import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorQuadraticVoting } from "../target/types/anchor_quadratic_voting";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { createMint, mintTo, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

describe("anchor-quadratic-voting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorQuadraticVoting as Program<AnchorQuadraticVoting>;
  const connection = provider.connection;

  const creator = provider.wallet as anchor.Wallet;
  const voter = Keypair.generate();

  const daoName = "test dao";
  let governanceMint: PublicKey;
  let voterAta: PublicKey;

  // dao pda - seeds: "dao" + creator + name
  const [daoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dao"), creator.publicKey.toBuffer(), Buffer.from(daoName)],
    program.programId
  );

  // first proposal uses proposal_count = 0
  const [proposalPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal"),
      daoPda.toBuffer(),
      new anchor.BN(0).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  // vote pda - one per voter per proposal
  const [votePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), voter.publicKey.toBuffer(), proposalPda.toBuffer()],
    program.programId
  );

  before(async () => {
    // give voter some sol
    const sig = await connection.requestAirdrop(voter.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);

    // create governance token
    governanceMint = await createMint(connection, creator.payer, creator.publicKey, null, 6);
    console.log("mint:", governanceMint.toBase58());

    // setup voter token account
    voterAta = getAssociatedTokenAddressSync(governanceMint, voter.publicKey);
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(creator.publicKey, voterAta, voter.publicKey, governanceMint)
    );
    await provider.sendAndConfirm(tx);

    // mint 25 tokens (6 decimals so 25_000_000 raw)
    // sqrt(25_000_000) should give us 5000 credits
    await mintTo(connection, creator.payer, governanceMint, voterAta, creator.payer, 25_000_000);
    console.log("minted 25 governance tokens to voter");
  });

  it("Initialize DAO", async () => {
    await program.methods
      .initializeDao(daoName)
      .accountsPartial({
        creator: creator.publicKey,
        dao: daoPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const dao = await program.account.dao.fetch(daoPda);
    console.log("dao created:", dao.name, "proposals:", dao.proposalCount.toNumber());

    expect(dao.authority.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(dao.name).to.equal(daoName);
    expect(dao.proposalCount.toNumber()).to.equal(0);
  });

  it("Create Proposal", async () => {
    const metadata = "should we add dark mode?";

    await program.methods
      .createProposal(metadata)
      .accountsPartial({
        proposer: creator.publicKey,
        dao: daoPda,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    console.log("proposal:", proposal.metadata);
    console.log("votes - yes:", proposal.yesVoteCount.toNumber(), "no:", proposal.noVoteCount.toNumber());

    expect(proposal.metadata).to.equal(metadata);
    expect(proposal.yesVoteCount.toNumber()).to.equal(0);
    expect(proposal.noVoteCount.toNumber()).to.equal(0);

    // dao proposal count should have gone up
    const dao = await program.account.dao.fetch(daoPda);
    expect(dao.proposalCount.toNumber()).to.equal(1);
  });

  it("Cast vote - quadratic", async () => {
    // voting yes (1) with 25 tokens
    await program.methods
      .vote(1)
      .accountsPartial({
        voter: voter.publicKey,
        proposal: proposalPda,
        vote: votePda,
        tokenAccount: voterAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter])
      .rpc();

    const vote = await program.account.vote.fetch(votePda);
    console.log("voted! type:", vote.voteType, "credits:", vote.credits.toNumber());

    // 25 tokens = 25_000_000 raw, sqrt(25_000_000) = 5000
    expect(vote.voteType).to.equal(1);
    expect(vote.credits.toNumber()).to.equal(5000);

    const proposal = await program.account.proposal.fetch(proposalPda);
    console.log("proposal after vote - yes:", proposal.yesVoteCount.toNumber(), "no:", proposal.noVoteCount.toNumber());
    expect(proposal.yesVoteCount.toNumber()).to.equal(5000);
    expect(proposal.noVoteCount.toNumber()).to.equal(0);
  });

  it("Double vote blocked", async () => {
    // same voter same proposal - should fail because vote pda already exists
    try {
      await program.methods
        .vote(0)
        .accountsPartial({
          voter: voter.publicKey,
          proposal: proposalPda,
          vote: votePda,
          tokenAccount: voterAta,
          systemProgram: SystemProgram.programId,
        })
        .signers([voter])
        .rpc();
      expect.fail("shouldnt get here");
    } catch (e) {
      console.log("double vote blocked as expected");
    }
  });
});
