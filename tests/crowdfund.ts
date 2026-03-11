import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfund } from "../target/types/crowdfund";
import { expect } from "chai";

const { SystemProgram, Keypair, PublicKey } = anchor.web3;

describe("crowdfund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfund as Program<Crowdfund>;

  const airdrop = async (pubkey: PublicKey, sol: number) => {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const warpToAfter = async (deadline: number) => {
    const slot = await provider.connection.getSlot("processed");
    const current = Math.floor(Date.now() / 1000);
    if (current >= deadline) return;
    const secondsAhead = deadline - current + 2;
    const approxSlotTime = 0.4;
    const slotsToAdvance = Math.ceil(secondsAhead / approxSlotTime);
    const targetSlot = slot + slotsToAdvance;
    // local validator supports warp
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (provider.connection as any)._rpcRequest("warp", [targetSlot]);
  };

  it("follows the checklist on localnet", async () => {
    const campaign = Keypair.generate();
    const donor = Keypair.generate();

    await airdrop(donor.publicKey, 1200);

    const now = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(now + 86400);
    const goal = new anchor.BN(1000 * anchor.web3.LAMPORTS_PER_SOL);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaign.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createCampaign(goal, deadline)
      .accounts({
        creator: provider.wallet.publicKey,
        campaign: campaign.publicKey,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([campaign])
      .rpc();

    const [donationPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("donation"),
        campaign.publicKey.toBuffer(),
        donor.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .contribute(new anchor.BN(600 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
        vault: vaultPda,
        donation: donationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    await program.methods
      .contribute(new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
        vault: vaultPda,
        donation: donationPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    try {
      await program.methods
        .withdraw()
        .accounts({
          creator: provider.wallet.publicKey,
          campaign: campaign.publicKey,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      throw new Error("withdraw before deadline should fail");
    } catch (err) {
      expect(`${err}`).to.contain("CampaignNotEnded");
    }

    await warpToAfter(deadline.toNumber());

    await program.methods
      .withdraw()
      .accounts({
        creator: provider.wallet.publicKey,
        campaign: campaign.publicKey,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .withdraw()
        .accounts({
          creator: provider.wallet.publicKey,
          campaign: campaign.publicKey,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      throw new Error("withdraw after claim should fail");
    } catch (err) {
      expect(`${err}`).to.contain("AlreadyClaimed");
    }
  });
});
