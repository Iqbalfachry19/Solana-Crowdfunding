import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfund } from "../target/types/crowdfund";
import { expect } from "chai";

const { Keypair } = anchor.web3;

describe("crowdfund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfund as Program<Crowdfund>;

  const airdrop = async (pubkey: anchor.web3.PublicKey, sol: number) => {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
    await provider.connection.confirmTransaction(
      {
        signature: sig,
        ...latestBlockhash,
      },
      "confirmed"
    );
  };


  it("follows the checklist on localnet", async () => {
    const campaign = Keypair.generate();
    const donor = Keypair.generate();
    console.log(`[Setup] Created campaign at ${campaign.publicKey.toBase58()}`);
    console.log(`[Setup] Donor is ${donor.publicKey.toBase58()}`);

    await airdrop(donor.publicKey, 1200);
    console.log(`[Setup] Airdropped 1200 SOL to donor`);


    const now = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(now + 2); // 2 seconds from now
    const goal = new anchor.BN(1000 * anchor.web3.LAMPORTS_PER_SOL);

    console.log(`[Campaign] Creating campaign: Goal=${goal.div(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))} SOL, Deadline=${deadline}`);
    await program.methods
      .createCampaign(goal, deadline)
      .accounts({
        campaign: campaign.publicKey,
      })
      .signers([campaign])
      .rpc();
    console.log(`[Campaign] Campaign created at ${campaign.publicKey.toBase58()}`);

    console.log(`[Contribute] Donor contributing 600 SOL...`);
    await program.methods
      .contribute(new anchor.BN(600 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();
    console.log(`[Contribute] Donation of 600 SOL successful`);

    console.log(`[Contribute] Donor contributing 500 SOL...`);
    await program.methods
      .contribute(new anchor.BN(500 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();
    console.log(`[Contribute] Donation of 500 SOL successful (Total: 1100 SOL)`);

    console.log(`[Check] Attempting withdrawal BEFORE deadline...`);
    try {
      await program.methods
        .withdraw()
        .accounts({
          campaign: campaign.publicKey,
        })
        .rpc();
      throw new Error("withdraw before deadline should fail");
    } catch (err) {
      console.log(`[Check] Correctly received expected error: CampaignNotEnded`);
      expect(`${err}`).to.contain("CampaignNotEnded");
    }

    console.log(`[Wait] Waiting 3 seconds for campaign to end (Deadline: ${deadline})...`);
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`[Withdraw] Attempting withdrawal AFTER deadline...`);
    await program.methods
      .withdraw()
      .accounts({
        campaign: campaign.publicKey,
      })
      .rpc();
    console.log(`[Withdraw] Funds successfully withdrawn by creator`);

    console.log(`[Check] Attempting double withdrawal...`);
    try {
      await program.methods
        .withdraw()
        .accounts({
          campaign: campaign.publicKey,
        })
        .rpc();
      throw new Error("withdraw after claim should fail");
    } catch (err) {
      console.log(`[Check] Correctly received expected error: AlreadyClaimed`);
      expect(`${err}`).to.contain("AlreadyClaimed");
    }
    console.log(`[Success] All checks passed!`);
  });
});
