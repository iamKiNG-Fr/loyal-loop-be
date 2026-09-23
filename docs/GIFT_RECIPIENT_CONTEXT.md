# Gift recipient context — Batch 82

Gift recipient name, phone and optional occasion belong to the cart group, order request and delivery. The purchasing customer stays unchanged on the sale. Gift context is carried through request conversion, owner sale/delivery responses and the authenticated customer delivery response. Private confirmation codes are never added to rider instructions.

Phone validation accepts familiar formatting with 7–15 digits; it rejects arbitrary text but does not verify reachability. DTOs validate supplied numbers, and submission services recheck legacy gift drafts. Empty cart fields can be cleared.

`20260922000000_gift_occasion` adds nullable text columns to the three existing tables. It was validated and generated locally, **not applied**. Apply this additive migration through an authorized release before deploying this API version. No backfill is required; existing orders simply have no occasion.

Verification: Prisma validation, backend build and 287/287 tests pass. New tests cover malformed numbers at all three request boundaries, legacy drafts, gift-only serialization, preserved bank instructions, buyer scoping and unpaid-stage rejection. Tests use mocks and no shared database writes.
