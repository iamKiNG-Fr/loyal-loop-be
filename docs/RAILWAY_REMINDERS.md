# Railway reminder rollout

Loyal Loop keeps reminder timing outside the API process. The API builds each owner's live Today list, enforces consent and idempotency, and queues delivery. A short-lived Railway cron service calls that API every five minutes and exits.

This is deliberate: an in-process timer can be duplicated by horizontal scaling, reset by deployments, and missed while a service sleeps or restarts. Railway cron is a better production trigger, while the protected HTTP endpoint keeps the business logic in one place.

## 1. Deploy the additive schema first

Deploy `prisma/migrations/20260803120000_owner_attention_digest` through the existing production migration process. It adds owner read receipts, push subscriptions, digest consent/preferences, an owner-digest outbox purpose, and order-request read state. It does not enable WhatsApp or schedule a job.

Do not enable reminder delivery until the API deployment using this schema is healthy.

## 2. Configure the API service

Set these server-only variables on the existing API service. Prefer making `REMINDER_SCHEDULER_SECRET` a Railway shared variable referenced by both the API and cron services; otherwise copy the same value to both services:

```dotenv
REMINDER_SCHEDULER_SECRET=<independent random secret of at least 32 bytes>
WEB_PUSH_VAPID_PUBLIC_KEY=<generated public key>
WEB_PUSH_VAPID_PRIVATE_KEY=<generated private key>
WEB_PUSH_SUBJECT=mailto:support@useloyalloop.com
```

Generate the VAPID pair once from the backend repository and keep the pair stable so existing device subscriptions remain usable:

```bash
node scripts/generate-vapid-keys.mjs
```

For WhatsApp digest delivery, also configure the normal Twilio production variables and:

```dotenv
TWILIO_OWNER_DIGEST_CONTENT_SID=HX...
```

The approved utility template must have four variables, in this order: owner name, business name, concise task summary, and the Loyal Loop Today URL. Keep the existing WhatsApp kill switch and production-readiness gates in place until the template and sender have passed acceptance.

## 3. Add the Railway cron service

Create a second Railway service from the same backend repository. Use the backend repository root (or set the service Root Directory to the backend folder if this later becomes a monorepo).

- Start command: `npm run reminders:cron`
- Cron schedule: `*/5 * * * *`
- Health check: none; this is a run-to-completion service
- Replicas: one

Railway evaluates cron schedules in UTC and currently supports a minimum interval of five minutes. The app still evaluates each owner's configured time, selected weekdays, and business timezone; the five-minute cron merely gives it regular opportunities to run. A three-hour catch-up window tolerates a delayed invocation, while `lastDailyDigestAt` and the message idempotency key prevent duplicate daily digests.

Set these variables on the cron service:

```dotenv
REMINDER_CRON_API_URL=http://${{backend-api.RAILWAY_PRIVATE_DOMAIN}}:${{backend-api.PORT}}
REMINDER_SCHEDULER_SECRET=${{shared.REMINDER_SCHEDULER_SECRET}}
REMINDER_CRON_PROCESS_MESSAGES=false
```

Replace `backend-api` with the actual Railway API service name. Set a concrete `PORT` variable on the API service (for example `5000`) so the service reference resolves; Railway does not synthesize `backend-api.PORT` from its runtime-injected port. Private service traffic uses `http`, including the port, and remains encrypted inside Railway's private mesh. The API binds to `::` so the call also works in legacy IPv6-only Railway environments. A public HTTPS API URL is the fallback when the cron and API are not in the same project environment.

When production WhatsApp sending is approved, either keep the existing messaging worker trigger or let this cron drain the outbox by setting:

```dotenv
REMINDER_CRON_PROCESS_MESSAGES=true
MESSAGING_WORKER_SECRET=${{shared.MESSAGING_WORKER_SECRET}}
```

Do not configure two independent message-worker schedules unless that is intentional. Outbox claiming is safe, but duplicate workers add noise and make operations harder to reason about.

## 4. Roll out in stages

1. Deploy the migration and API with all delivery switches off.
2. Generate VAPID keys, connect one internal test device, and use **Send a test** in Settings.
3. Run the cron once manually and confirm its JSON log reports checked businesses without errors.
4. Enable the five-minute schedule and observe a full business day with only push enabled.
5. Approve the Twilio owner-digest template, test with allowlisted owners, then enable production WhatsApp gates.
6. Owners must explicitly enable the digest in Settings. Disabling it revokes the owner-digest consent record and stops future digest queueing.

## Operational checks

- A cron run must finish and exit; Railway skips a new invocation if the previous one is still running.
- Alert read state is per owner and per business. Opening the bell marks visible alerts seen; it does not complete the underlying work.
- Snoozing hides a Today item until the chosen time but does not change the order, payment, delivery, issue, or inventory record.
- Empty Today lists do not send a digest.
- Unscheduled urgent Push is bounded to 07:00–21:00 in the business timezone; the owner-selected digest time remains separate.
- WhatsApp delivery uses an approved utility template because a scheduled morning digest is normally outside WhatsApp's 24-hour customer-service window.
- Keep `REMINDER_SCHEDULER_SECRET`, VAPID private key, Twilio auth token, and worker secret server-only and rotate them independently.

Railway reference: <https://docs.railway.com/cron-jobs>
