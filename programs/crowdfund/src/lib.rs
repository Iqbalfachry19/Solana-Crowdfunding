#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("BNFAjhZF1EsQZpcKCGv3tEuc4mDucQtrAVphYQHoNLU");

#[program]
pub mod crowdfund {
    use super::*;

    pub fn create_campaign(ctx: Context<CreateCampaign>, goal: u64, deadline: i64) -> Result<()> {
        let clock = Clock::get()?;
        require!(deadline > clock.unix_timestamp, CrowdfundError::DeadlineInPast);

        let campaign = &mut ctx.accounts.campaign;
        campaign.creator = ctx.accounts.creator.key();
        campaign.goal = goal;
        campaign.raised = 0;
        campaign.deadline = deadline;
        campaign.claimed = false;

        msg!("Campaign created: goal={}, deadline={}", goal, deadline);
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        require!(amount > 0, CrowdfundError::InvalidAmount);

        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;
        require!(clock.unix_timestamp < campaign.deadline, CrowdfundError::CampaignEnded);
        let donation = &mut ctx.accounts.donation;

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.donor.key(),
            &ctx.accounts.vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.donor.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        campaign.raised = campaign
            .raised
            .checked_add(amount)
            .ok_or(CrowdfundError::MathOverflow)?;
        donation.donor = ctx.accounts.donor.key();
        donation.campaign = campaign.key();
        donation.amount = donation
            .amount
            .checked_add(amount)
            .ok_or(CrowdfundError::MathOverflow)?;

        msg!("Contributed: {} lamports, total={}", amount, campaign.raised);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let campaign_key = ctx.accounts.campaign.key();
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= campaign.deadline, CrowdfundError::CampaignNotEnded);
        require!(campaign.raised >= campaign.goal, CrowdfundError::GoalNotReached);
        require!(!campaign.claimed, CrowdfundError::AlreadyClaimed);
        let amount = ctx.accounts.vault.lamports();
        if amount > 0 {
            let seeds = &[b"vault", campaign_key.as_ref(), &[ctx.bumps.vault]];
            let signer = &[&seeds[..]];

            let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.vault.key(),
                &ctx.accounts.creator.key(),
                amount,
            );
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_ix,
                &[
                    ctx.accounts.vault.to_account_info(),
                    ctx.accounts.creator.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
        }

        campaign.claimed = true;
        msg!("Withdrawn: {} lamports", amount);
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let campaign_key = ctx.accounts.campaign.key();
        let campaign = &mut ctx.accounts.campaign;
        let donation = &mut ctx.accounts.donation;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= campaign.deadline, CrowdfundError::CampaignNotEnded);
        require!(campaign.raised < campaign.goal, CrowdfundError::GoalReached);
        require!(donation.amount > 0, CrowdfundError::NothingToRefund);

        let amount = donation.amount;

        let seeds = &[b"vault", campaign_key.as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.donor.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.donor.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        donation.amount = 0;
        campaign.raised = campaign
            .raised
            .checked_sub(amount)
            .ok_or(CrowdfundError::MathOverflow)?;

        msg!("Refunded: {} lamports", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::SIZE
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

#[account(
    init_if_needed,
    payer = donor,
    space = 8 + Donation::SIZE,
    seeds = [b"donation", campaign.key().as_ref(), donor.key().as_ref()],
    bump,
    constraint = donation.donor == Pubkey::default() || donation.donor == donor.key() @ CrowdfundError::InvalidDonor,
    constraint = donation.campaign == Pubkey::default() || donation.campaign == campaign.key() @ CrowdfundError::InvalidCampaign,
)]
pub donation: Account<'info, Donation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"donation", campaign.key().as_ref(), donor.key().as_ref()],
        bump,
        close = donor
    )]
    pub donation: Account<'info, Donation>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Campaign {
    pub creator: Pubkey,
    pub goal: u64,
    pub raised: u64,
    pub deadline: i64,
    pub claimed: bool,
}

impl Campaign {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Donation {
    pub donor: Pubkey,
    pub campaign: Pubkey,
    pub amount: u64,
}

impl Donation {
    pub const SIZE: usize = 32 + 32 + 8;
}


#[error_code]
pub enum CrowdfundError {
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Campaign already claimed")]
    AlreadyClaimed,
    #[msg("Goal not reached")]
    GoalNotReached,
    #[msg("Goal reached; refunds not allowed")]
    GoalReached,
    #[msg("Campaign not ended yet")]
    CampaignNotEnded,
    #[msg("Campaign already ended")]
    CampaignEnded,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid donor for this donation account")]  
    InvalidDonor,
    #[msg("Invalid campaign for this donation account")]
    InvalidCampaign,
}
