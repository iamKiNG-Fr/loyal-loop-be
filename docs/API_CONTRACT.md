# Loyal Loop API Contract

Base path: `/api/v1`

## Response shape

Success:

```json
{
  "success": true,
  "message": "Request completed",
  "data": {},
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

Failure:

```json
{
  "success": false,
  "message": "Customer not found",
  "data": null,
  "code": "NOT_FOUND",
  "requestId": "..."
}
```

Money is serialized by Prisma as decimal-safe values and clients must treat it
as decimal text, not binary floating-point. Dates are ISO UTC timestamps.

## Authentication

- Owners: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
  and `GET /auth/me`.
- Owner sessions use the HTTP-only `ll_owner_session` cookie.
- Customer shop identity: `POST /customer-auth/whatsapp/start` and
  `/customer-auth/whatsapp/verify`.
- Customer sessions use the HTTP-only `ll_customer_session` cookie.
- Authenticated business writes derive scope from membership. `X-Business-Id`
  may select one of the signed-in user's active memberships but cannot invent a
  business scope.

## Route groups

- `/businesses/current`: identity, contacts, pledge, preferences, invitations
- `/users/me`: personal details and workspace appearance
- `/media`: Cloudinary signatures and registered assets
- `/customers`: CRUD, notes, tags, and timeline
- `/products`: CRUD and ordered images
- `/sales`: transactional sales and payment ledger entries
- `/receipts`: owner receipt management
- `/deliveries`: owner delivery management and issue resolution
- `/follow-ups`: templates, suggestions, approval, and completion
- `/activity`, `/dashboard`, `/trust`, `/support`, `/billing/plan`
- `/public/shops`: public shop, products, requests, wishlists, and interests
- `/public/receipts/:token`: view, acknowledge, and report an issue
- `/public/deliveries/:token`: view, confirm, rate, and report an issue

`Idempotency-Key` is accepted when creating a sale and converting a public
request. Customer delivery confirmation and feedback are intrinsically
idempotent.

## Public-token policy

Public links contain 32-byte URL-safe random tokens. Only SHA-256 hashes are
stored. Internal IDs and raw token values are never used interchangeably.

## Trust policy

Trust points are written only by server activity events. Rating value never
changes points. Public trust responses always include:

> Trust levels reflect recorded Loyal Loop activity and are not business
> verification.
