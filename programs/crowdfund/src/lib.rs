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
        let donation_info = &ctx.accounts.donation;
        let donation_bump = ctx.bumps.donation;

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

        if donation_info.lamports() == 0 {
            let campaign_key = campaign.key();
            let donor_key = ctx.accounts.donor.key();
            let space = 8 + Donation::SIZE;
            let rent = Rent::get()?;
            let lamports = rent.minimum_balance(space);
            let seeds = &[
                b"donation",
                campaign_key.as_ref(),
                donor_key.as_ref(),
                &[donation_bump],
            ];
            let signer = &[&seeds[..]];
            let create_ix = anchor_lang::solana_program::system_instruction::create_account(
                &ctx.accounts.donor.key(),
                &donation_info.key(),
                lamports,
                space as u64,
                ctx.program_id,
            );
            anchor_lang::solana_program::program::invoke_signed(
                &create_ix,
                &[
                    ctx.accounts.donor.to_account_info(),
                    donation_info.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;

            let mut data = donation_info.data.borrow_mut();
            let mut cursor: &mut [u8] = &mut data;
            let donation = Donation {
                donor: donor_key,
                campaign: campaign_key,
                amount: 0,
            };
            donation.try_serialize(&mut cursor)?;
        }

        let mut donation_data = donation_info.data.borrow_mut();
        let mut cursor: &[u8] = &donation_data;
        let mut donation = Donation::try_deserialize(&mut cursor)?;

        campaign.raised = campaign
            .raised
            .checked_add(amount)
            .ok_or(CrowdfundError::MathOverflow)?;
        donation.amount = donation
            .amount
            .checked_add(amount)
            .ok_or(CrowdfundError::MathOverflow)?;

        let mut write_cursor: &mut [u8] = &mut donation_data;
        donation.try_serialize(&mut write_cursor)?;

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
        require!(campaign.creator == ctx.accounts.creator.key(), CrowdfundError::Unauthorized);

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
        let donation_info = &ctx.accounts.donation;
        let clock = Clock::get()?;

        require!(clock.unix_timestamp >= campaign.deadline, CrowdfundError::CampaignNotEnded);
        require!(campaign.raised < campaign.goal, CrowdfundError::GoalReached);
        let mut donation_data = donation_info.data.borrow_mut();
        let mut cursor: &[u8] = &donation_data;
        let mut donation = Donation::try_deserialize(&mut cursor)?;
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
        let mut write_cursor: &mut [u8] = &mut donation_data;
        donation.try_serialize(&mut write_cursor)?;
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
    /// CHECK: PDA vault, created with zero space/lamports initially.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: PDA vault for holding funds.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    /// CHECK: PDA donation account; created manually if missing.
    #[account(
        mut,
        seeds = [b"donation", campaign.key().as_ref(), donor.key().as_ref()],
        bump
    )]
    pub donation: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: PDA vault for holding funds.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: PDA vault for holding funds.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    /// CHECK: PDA donation account.
    #[account(
        mut,
        seeds = [b"donation", campaign.key().as_ref(), donor.key().as_ref()],
        bump
    )]
    pub donation: AccountInfo<'info>,
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
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Campaign already claimed")]
    AlreadyClaimed,
    #[msg("Goal not reached")]
    GoalNotReached,
    #[msg("Goal reached; refunds not allowed")]
    GoalReached,
    #[msg("Campaign not ended yet")]
    CampaignNotEnded,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
}
