# Anchor Crowdfunding Program

Anchor-based implementation of the crowdfunding spec.

## Instructions

- `create_campaign(goal, deadline)`
- `contribute(amount)`
- `withdraw()`
- `refund()`

## PDAs

- Vault: `[b"vault", campaign]`
- Donation: `[b"donation", campaign, donor]`

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


