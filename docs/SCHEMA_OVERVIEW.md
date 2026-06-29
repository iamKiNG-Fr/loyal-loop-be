# Loyal Loop Schema Overview

`prisma/schema.prisma` is the source of truth. Files under
`src/generated/prisma` are generated and must not be hand-edited.

## Identity and tenancy

- `User`, `OwnerSession`, and `PasswordRecoveryToken` provide owner identity.
- `Business`, `BusinessMember`, and `BusinessInvitation` scope every workspace
  record and enforce owner, manager, sales, delivery, and viewer roles.
- `CustomerAccount`, `CustomerAccountSession`, and `CustomerOtpChallenge`
  provide optional WhatsApp-verified identity only for cross-device shop state.
  Public receipts and deliveries do not require customer accounts.

## Business and media

- `BusinessPreferences` stores regional, receipt, shop, notification, and
  privacy settings.
- `BusinessContact` stores normalized social/contact identities.
- `MediaAsset` owns Cloudinary metadata; `ProductImage` orders business-owned
  assets on a product. Business logos also reference a `MediaAsset`.

## Customer memory and commerce

- `Customer`, contacts, notes, tags, and assignments form business-owned
  customer memory.
- `Product` stores catalog truth; media, status, visibility, placement, and
  stock are explicit.
- `OrderRequest` and its items preserve guest request snapshots.
- `WishlistItem`, `ProductInterest`, and `CommerceEvent` persist authenticated
  shop state and aggregate-safe engagement.

## Transaction and trust

- `Sale` and `SaleItem` preserve historical item and price snapshots.
- `PaymentEntry` is an auditable payment-status ledger; it does not collect
  money.
- `Receipt` and `Delivery` use SHA-256 token hashes for public access.
- `DeliveryEvent`, `CustomerFeedback`, and `CustomerIssue` preserve customer
  confirmation and aftercare history.
- `ActivityEvent` is the immutable timeline source.
- `TrustLedgerEntry` can only be created from one activity event and prevents
  duplicate awards with a unique source relation.
- `FollowUpTemplate` and `FollowUpSuggestion` support owner-approved follow-up.

## Migration order

1. existing waitlist baseline
2. identity and media foundation
3. commerce core
4. public engagement
5. trust and rewards

These migrations are additive and preserve the existing `waitlist` table.
