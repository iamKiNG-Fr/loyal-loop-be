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

## Batch Execution Protocol

This protocol applies to every future batch and individual MB issue unless the
user explicitly changes the scope or rules. The workspace-level
`MASTER_BACKLOG.md` is the source of truth for execution state and issue status.

### Before starting a batch

- Read `MASTER_BACKLOG.md`.
- Check its **Current Execution State**.
- Confirm the target batch and affected MB issue IDs before changing app files.
- Work only on the confirmed batch or issue IDs; do not include unrelated
  batches.
- If implementation unexpectedly requires backend, database, schema, or
  provider changes, pause and ask the user for approval before making them.

### During implementation

- Keep changes focused on the active batch and confirmed MB issue IDs.
- Maintain code quality and reuse existing components, services, conventions,
  and patterns.
- Avoid broad rewrites unless necessary; explain the need and scope when they
  cannot be avoided.
- Do not touch `package-lock.json` unless the active issue explicitly allows it.
- Do not seed, reset, wipe, or destructively migrate any database.
- Do not expose, print, commit, or reproduce environment secrets.

### After finishing a batch

- Run the available relevant build and tests. For documentation-only work,
  validate the changed documentation without running unrelated application
  commands.
- Update `MASTER_BACKLOG.md` status fields for every affected issue.
- Add concrete verification notes and any relevant commit or PR reference.
- Mark each affected issue **Done**, **Blocked**, **Deferred**, or **In progress**;
  do not mark work Done from implementation presence alone.
- Update **Current Execution State**.
- Recommend the next safest batch based on dependencies, risk, and remaining
  MVP blockers.
- Summarize changed files, risks, verification performed, and remaining issues.

### Linear and Notion

- Do not update Linear or Notion automatically.
- Prepare proposed update notes only when the user asks for them.
- Wait for explicit user approval before writing to Linear, Notion, or another
  external tracking tool.

### Command format

- **“Start Batch 2”** means implement only Batch 2 using this protocol.
- **“Start MB-703”** means implement only MB-703 using this protocol.
- **“Continue next recommended batch”** means use `MASTER_BACKLOG.md` to choose
  and execute the next safe batch using this protocol.
