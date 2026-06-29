# Loyal Loop Backend Codex Instructions

These instructions apply to backend work in the Loyal Loop API repo.

## Product Context

Loyal Loop is a social-first customer memory and trust engine for business
owners who sell through WhatsApp, Instagram, DMs, physical stores, and repeat
customer relationships.

Backend work should support the MVP spine:

Business owner signs up, sets up business identity, adds a customer, adds a
product, logs a sale, generates a trusted receipt, shares the receipt, tracks
delivery, confirms delivery, views customer history, and follows up.

## MVP Boundaries

Prioritize:

- auth and business identity
- customers, notes, and tags
- products
- sales
- receipts and public receipt tokens
- delivery tracking
- customer delivery confirmation
- activity/events
- follow-up template support
- lightweight plan/trial fields for a commitment signal

Keep these out of MVP unless the user explicitly requests them:

- wallet
- payment collection
- Paystack checkout
- full WhatsApp Business API
- OTP customer accounts
- marketplace
- auction/bidding
- mobile app wrapper
- AI campaigns
- advanced analytics
- full customer app
- loyalty/referral points

## Implementation Rules

- Use clear module boundaries, services, DTOs, validation, and database models.
- Model around `Business`, `BusinessMember`, and owner/staff roles rather than
  `Vendor`.
- Keep records business-scoped unless a feature explicitly needs public/token
  access.
- Public customer/receipt access should use soft token links for MVP, not full
  customer accounts.
- Do not imply business verification unless the backend actually supports a real
  verification state.
- Keep API responses consistent and useful for the frontend.
