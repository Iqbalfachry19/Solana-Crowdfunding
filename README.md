# Anchor Crowdfunding Program

Anchor-based implementation of the crowdfunding spec.

## Instructions

- **`create_campaign(goal, deadline)`**: Initializes a new crowdfunding campaign. The `goal` (in lamports) and `deadline` (Unix timestamp) are set. The `campaign` account is created, and the `vault` PDA is derived to hold the funds.
- **`contribute(amount)`**: Allows a donor to contribute a specific `amount` (in lamports) to an active campaign. Funds are transferred to the `vault` PDA. A `donation` PDA is created or updated if the donor has already contributed to track the total amount.
- **`withdraw()`**: Enables the campaign creator to withdraw all funds from the `vault` PDA if the campaign's `goal` has been met and the `deadline` has passed.
- **`refund()`**: Allows a donor to claim a full refund of their contribution if the campaign failed to reach its `goal` by the `deadline`. Funds are transferred from the `vault` PDA back to the donor's wallet.

## PDAs (Program Derived Addresses)

- **Vault**: `[b"vault", campaign_pubkey]`
    - This is a system-owned account (managed by the program) that acts as a secure escrow for all contributed SOL. It holds funds until they are either withdrawn by the creator or refunded to donors.
- **Donation**: `[b"donation", campaign_pubkey, donor_pubkey]`
    - This account stores metadata about a specific donor's contribution to a specific campaign, primarily the total `amount` donated, ensuring accurate records for refund processing.

## Build

```bash
anchor build
```

## Test

```bash
anchor test
```

## Deploy

```bash
anchor deploy --provider.cluster devnet
```
- Program Id: BNFAjhZF1EsQZpcKCGv3tEuc4mDucQtrAVphYQHoNLU
- Signature: 3KyrURS1hxpw1AAgwh2gtK62BDQgrde8Qmn448W3CNyArJynR2JxSiLxT1FdnStQAHaoWeJhmiZxFdUK51Ay9YnQ


