# Loyal Loop Backend

Nest 11, Prisma 7, and PostgreSQL API for Loyal Loop's business workspace,
customer memory, public shop, receipts, delivery, and trust activity.

## Implemented Backend Foundation

- owner email/password authentication with rotating opaque cookie sessions
- business-scoped membership guards and role policies
- business identity, contacts, preferences, pledge, and team invitations
- Cloudinary signed direct-upload registration and asset ownership
- customers, contacts, notes, tags, products, and ordered product media
- transactional sale, receipt, optional delivery, payment ledger, and activity
- tokenized public receipt acknowledgement and delivery confirmation
- guest shop requests plus customer-account wishlist/restock persistence
- WhatsApp OTP provider boundary with a Twilio Verify adapter
- follow-up templates/suggestions, feedback, issues, dashboard data, and support
- deterministic server-authored trust points, levels, streaks, and badges
- four additive migrations after the existing waitlist migration

The API never collects payments and trust levels are not business verification.

## Development

```bash
npm install
npm run prisma:generate
npm run db:setup
npm test
npm run build
npm run start:dev
```

The API prefix is `/api/v1`. Configure all values shown in `.env.example`.
`db:setup` uses a small PostgreSQL migration runner because Prisma's Windows
schema engine can fail before executing SQL against some Neon connection strings.
Cloudinary and Twilio credentials are optional in local development but required
for their production flows.

Set `DATABASE_SAFETY_MODE` to `local`, `isolated`, `shared`, or `production`.
Development OTP is allowed only with local data or an explicitly isolated remote
database and is always blocked in production. Never label shared data as isolated.

### Isolated database QA

Keep the restored shared profile in `.env`. Put the provider-verified test branch
in `.env.isolated.local`; both files are ignored. The isolated file must set
`DATABASE_SAFETY_MODE=isolated`, record its Neon project, branch, and endpoint
IDs, and disable Resend, Cloudinary, and Twilio credentials before automated QA.

```bash
npm run check:isolated
npm run build
npm run verify:isolated-core
npm run start:dev:isolated
```

`check:isolated` validates the recorded endpoint, confirms that it differs from
the shared URL, and performs read-only provider/schema checks without printing
credentials. `verify:isolated-core` starts the built API with only the isolated
profile and creates uniquely named QA records through the public API; it never
seeds, resets, wipes, or migrates a database.

Do not reuse isolated QA records as product/demo data. Keep the branch while it
is the active local test target, then delete it through Neon when it is replaced.
Create a fresh schema-only branch rather than resetting or wiping an old branch.

The repeatable demo seed creates:

- owner: `demo@useloyalloop.com`
- password: `LoyalLoopDemo123!`
- shop: `kings-store-demo`

Rerunning the seed replaces only that exact demo owner/workspace. It never
deletes the waitlist or other businesses.

Do not run `prisma db push` against shared environments. Apply the checked-in
migrations to an isolated database first, then a preview environment, and only
then the shared database.

## Contracts

- [API contract](./docs/API_CONTRACT.md)
- [Schema overview](./docs/SCHEMA_OVERVIEW.md)
