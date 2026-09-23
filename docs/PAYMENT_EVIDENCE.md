# Payment and refund evidence — Batch 83

Owner-recorded payments may attach a receipt image. New refund entries require one. The image must be an active authenticated `PAYMENT_PROOF` image from the same business, unused by another payment or customer proof. The unique relation prevents concurrent reuse; attachment deletion is blocked. Existing historical refunds remain readable without evidence.

Only staff with `PAYMENT_REVIEW` receive signed evidence URLs in sale responses. The authenticated buyer's order journey receives a narrow refund projection with amount, date and signed image URL; private ledger notes, recorder identity and ordinary payment images are excluded. The UI describes this as a refund recorded by the shop, not independently verified money receipt. Fully refunded orders do not reveal a handoff code.

Payment balance changes use an atomic comparison against the recorded balance inside the same transaction as the ledger entry. A stale concurrent write must refresh before retrying. Normal payment still unlocks an awaiting order; refunds never unlock fulfilment.

Migration `20260923000000_payment_evidence` adds a nullable unique media relation to `payment_entries`. Prepared and validated locally, **NOT applied**; it must precede deployment of this API version during an authorized release. No money-transfer provider is integrated or activated.

300 backend tests, TypeScript build and Prisma validation pass. Coverage includes mandatory evidence, tenant/media constraints, access control, deletion protection, full/partial refunds, invalid amounts, concurrent writes, normal-payment unlocking and the customer projection. All use isolated mocks.

## Outstanding WhatsApp delivery

Source MB-8303 also asks for a Loyal Loop WhatsApp refund update. Automatic refund messages remain **BLOCKED** on a configured/approved refund template and consent-aware notification delivery workflow. No provider was activated and no message was sent. Proposed factual copy for later approval: “The shop recorded a refund for order {{order_reference}}. Open your private order journey to view the amount and receipt image, then check your original payment method to confirm it arrived.” Do not claim Loyal Loop transferred or verified the money.
