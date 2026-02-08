import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import { expect } from "chai";
import {
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("anchor-amm-q4-25", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorAmmQ425 as Program<AnchorAmmQ425>;
  const user = provider.wallet.publicKey;

  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let userAtaX: anchor.web3.PublicKey;
  let userAtaY: anchor.web3.PublicKey;
  let userAtaLp: anchor.web3.PublicKey;

  const seed = new anchor.BN(69420);
  let configPda: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;

  // 100 tokens with 6 decimals
  const mintAmount = 100_000_000;

  before(async () => {
    await provider.connection.requestAirdrop(user, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise((r) => setTimeout(r, 1000));

    // create mints
    mintX = await createMint(provider.connection, provider.wallet.payer, user, null, 6);
    mintY = await createMint(provider.connection, provider.wallet.payer, user, null, 6);

    // derive config pda
    [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // derive lp mint
    [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), configPda.toBuffer()],
      program.programId
    );

    // derive vaults (ATAs owned by config)
    vaultX = getAssociatedTokenAddressSync(mintX, configPda, true);
    vaultY = getAssociatedTokenAddressSync(mintY, configPda, true);

    // create user ATAs and mint tokens
    userAtaX = getAssociatedTokenAddressSync(mintX, user);
    const createAtaXTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(user, userAtaX, user, mintX)
    );
    await provider.sendAndConfirm(createAtaXTx);
    await mintTo(provider.connection, provider.wallet.payer, mintX, userAtaX, provider.wallet.payer, mintAmount);

    userAtaY = getAssociatedTokenAddressSync(mintY, user);
    const createAtaYTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(user, userAtaY, user, mintY)
    );
    await provider.sendAndConfirm(createAtaYTx);
    await mintTo(provider.connection, provider.wallet.payer, mintY, userAtaY, provider.wallet.payer, mintAmount);

    // derive user lp ata (will be init_if_needed by deposit)
    userAtaLp = getAssociatedTokenAddressSync(mintLp, user);
  });

  it("Initialize", async () => {
    await program.methods
      .initialize(seed, 600, null)
      .accountsStrict({
        initializer: user,
        mintX: mintX,
        mintY: mintY,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    expect(config.seed.toNumber()).to.equal(seed.toNumber());
    expect(config.fee).to.equal(600);
    expect(config.mintX.toBase58()).to.equal(mintX.toBase58());
    expect(config.mintY.toBase58()).to.equal(mintY.toBase58());
    expect(config.locked).to.equal(false);
  });

  it("Deposit", async () => {
    const depositX = 20_000_000; // 20 tokens
    const depositY = 30_000_000; // 30 tokens
    const lpAmount = 1_000_000;  // 1 LP token

    await program.methods
      .deposit(new anchor.BN(lpAmount), new anchor.BN(depositX), new anchor.BN(depositY))
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userAtaX,
        userY: userAtaY,
        userLp: userAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // check vaults got funded
    const vaultXBal = await provider.connection.getTokenAccountBalance(vaultX);
    expect(Number(vaultXBal.value.amount)).to.equal(depositX);

    const vaultYBal = await provider.connection.getTokenAccountBalance(vaultY);
    expect(Number(vaultYBal.value.amount)).to.equal(depositY);

    // check user got LP tokens
    const lpBal = await provider.connection.getTokenAccountBalance(userAtaLp);
    expect(Number(lpBal.value.amount)).to.equal(lpAmount);
  });

  it("Swap", async () => {
    const swapAmount = 5_000_000; // swap 5 token X

    const userXBefore = await provider.connection.getTokenAccountBalance(userAtaX);
    const userYBefore = await provider.connection.getTokenAccountBalance(userAtaY);

    await program.methods
      .swap(true, new anchor.BN(swapAmount), new anchor.BN(0))
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userAtaX,
        userY: userAtaY,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userXAfter = await provider.connection.getTokenAccountBalance(userAtaX);
    const userYAfter = await provider.connection.getTokenAccountBalance(userAtaY);

    // user should have less X
    expect(Number(userXAfter.value.amount)).to.be.lessThan(Number(userXBefore.value.amount));
    // user should have more Y
    expect(Number(userYAfter.value.amount)).to.be.greaterThan(Number(userYBefore.value.amount));

    console.log(`Swapped ${swapAmount} X -> got ${Number(userYAfter.value.amount) - Number(userYBefore.value.amount)} Y`);
  });

  it("Withdraw", async () => {
    const lpBal = await provider.connection.getTokenAccountBalance(userAtaLp);
    const lpAmount = Number(lpBal.value.amount);

    const userXBefore = await provider.connection.getTokenAccountBalance(userAtaX);
    const userYBefore = await provider.connection.getTokenAccountBalance(userAtaY);

    await program.methods
      .withdraw(new anchor.BN(lpAmount), new anchor.BN(0), new anchor.BN(0))
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userAtaX,
        userY: userAtaY,
        userLp: userAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // LP tokens should be burned
    const lpAfter = await provider.connection.getTokenAccountBalance(userAtaLp);
    expect(Number(lpAfter.value.amount)).to.equal(0);

    // user should have gotten tokens back
    const userXAfter = await provider.connection.getTokenAccountBalance(userAtaX);
    const userYAfter = await provider.connection.getTokenAccountBalance(userAtaY);
    expect(Number(userXAfter.value.amount)).to.be.greaterThan(Number(userXBefore.value.amount));
    expect(Number(userYAfter.value.amount)).to.be.greaterThan(Number(userYBefore.value.amount));

    console.log(`Withdrew ${Number(userXAfter.value.amount) - Number(userXBefore.value.amount)} X and ${Number(userYAfter.value.amount) - Number(userYBefore.value.amount)} Y`);
  });
});
