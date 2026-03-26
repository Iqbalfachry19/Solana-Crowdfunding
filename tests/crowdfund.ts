import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfund } from "../target/types/crowdfund";
import { expect } from "chai";

const { Keypair } = anchor.web3;

describe("crowdfund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfund as Program<Crowdfund>;

  const isDevnet = provider.connection.rpcEndpoint.includes("devnet");

  const airdrop = async (pubkey: anchor.web3.PublicKey, amountSol: number) => {
    try {
      console.log(`[Airdrop] Requesting ${amountSol} SOL for ${pubkey.toBase58()}...`);
      const sig = await provider.connection.requestAirdrop(
        pubkey,
        amountSol * anchor.web3.LAMPORTS_PER_SOL
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
      await provider.connection.confirmTransaction(
        {
          signature: sig,
          ...latestBlockhash,
        },
        "confirmed"
      );
      console.log(`[Airdrop] Successfully airdropped ${amountSol} SOL`);
    } catch (e) {
      console.error(`[Airdrop] Failed to airdrop: ${e}`);
    }
  };

  it("follows the checklist on localnet", async function () {
    if (isDevnet) {
      console.log("Skipping localnet test because we are on devnet.");
      return this.skip();
    }

    const campaign = Keypair.generate();
    const donor = Keypair.generate();
    console.log(`[Setup] Created campaign at ${campaign.publicKey.toBase58()}`);
    console.log(`[Setup] Donor is ${donor.publicKey.toBase58()}`);

    await airdrop(donor.publicKey, 1200);

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
    console.log(`[Success] All checks passed for localnet!`);
  });

  it("allows donor to refund if goal is not reached", async function () {
    if (isDevnet) {
      console.log("Skipping localnet refund test because we are on devnet.");
      return this.skip();
    }

    const campaign = Keypair.generate();
    const donor = Keypair.generate();
    console.log(`[Refund Test] Created campaign at ${campaign.publicKey.toBase58()}`);
    console.log(`[Refund Test] Donor is ${donor.publicKey.toBase58()}`);

    await airdrop(donor.publicKey, 10);

    const now = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(now + 2); // 2 seconds deadline
    const goal = new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL); // High goal

    console.log(`[Refund Test] Creating campaign: Goal=100 SOL, Deadline=${deadline}`);
    await program.methods
      .createCampaign(goal, deadline)
      .accounts({
        campaign: campaign.publicKey,
      })
      .signers([campaign])
      .rpc();

    const contributionAmount = 5;
    const contribution = new anchor.BN(contributionAmount * anchor.web3.LAMPORTS_PER_SOL);
    console.log(`[Refund Test] Donor contributing ${contributionAmount} SOL...`);
    await program.methods
      .contribute(contribution)
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();

    console.log(`[Refund Test] Attempting refund BEFORE deadline...`);
    try {
      await program.methods
        .refund()
        .accounts({
          donor: donor.publicKey,
          campaign: campaign.publicKey,
        })
        .signers([donor])
        .rpc();
      throw new Error("refund before deadline should fail");
    } catch (err) {
      console.log(`[Refund Test] Correctly received expected error: CampaignNotEnded`);
      expect(`${err}`).to.contain("CampaignNotEnded");
    }

    console.log(`[Refund Test] Waiting 3 seconds for campaign to end...`);
    await new Promise((r) => setTimeout(r, 3000));

    const balanceBefore = await provider.connection.getBalance(donor.publicKey);
    console.log(`[Refund Test] Donor balance before refund: ${balanceBefore / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    
    console.log(`[Refund Test] Attempting refund AFTER deadline...`);
    await program.methods
      .refund()
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(donor.publicKey);
    console.log(`[Refund Test] Donor balance after refund: ${balanceAfter / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
    
    // Check contribution account state
    const [donationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("donation"), campaign.publicKey.toBuffer(), donor.publicKey.toBuffer()],
      program.programId
    );
    const donationAccount = await program.account.donation.fetch(donationPDA);
    console.log(`[Refund Test] Donation account amount: ${donationAccount.amount.toNumber()}`);
    expect(donationAccount.amount.toNumber()).to.equal(0);

    console.log(`[Refund Test] Success! Funds refunded correctly.`);
  });

  it("follows the checklist on devnet", async function () {
    if (!isDevnet) {
      console.log("Skipping devnet test because we are on localnet.");
      return this.skip();
    }

    const campaign = Keypair.generate();
    const donor = Keypair.generate();
    console.log(`[Setup] Created campaign at ${campaign.publicKey.toBase58()}`);
    console.log(`[Setup] Donor is ${donor.publicKey.toBase58()}`);


    await airdrop(donor.publicKey, 1.5);

    const now = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(now + 10); // 10 seconds from now
    const goal = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    console.log(`[Campaign] Creating campaign: Goal=${goal.div(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))} SOL, Deadline=${deadline}`);
    await program.methods
      .createCampaign(goal, deadline)
      .accounts({
        campaign: campaign.publicKey,
      })
      .signers([campaign])
      .rpc();
    console.log(`[Campaign] Campaign created at ${campaign.publicKey.toBase58()}`);

    console.log(`[Contribute] Donor contributing 0.6 SOL...`);
    await program.methods
      .contribute(new anchor.BN(0.6 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();
    console.log(`[Contribute] Donation of 0.6 SOL successful`);

    console.log(`[Contribute] Donor contributing 0.5 SOL...`);
    await program.methods
      .contribute(new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign.publicKey,
      })
      .signers([donor])
      .rpc();
    console.log(`[Contribute] Donation of 0.5 SOL successful (Total: 1.1 SOL)`);

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

    console.log(`[Wait] Waiting 15 seconds for campaign to end (Deadline: ${deadline})...`);
    await new Promise((r) => setTimeout(r, 15000));

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
    console.log(`[Success] All checks passed for devnet!`);
  });
});
