# Gemini and Twilio provider setup

The provider integrations are scaffolded and disabled by default. Keep every key in the backend environment only; none belongs in Nuxt public runtime configuration.

## Gemini

Loyal Loop uses the server-side `@google/genai` SDK for `parseDiscoveryQuery` and `summarizeCustomer`. Deterministic search and customer history remain available when Gemini is disabled or fails.

Required values:

```env
GEMINI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
GEMINI_TIMEOUT_MS=5000
GEMINI_CUSTOMER_TIMEOUT_MS=12000
```

Setup:

1. Create a Gemini Developer API key in Google AI Studio.
2. Store it as `GEMINI_API_KEY` in the backend service only.
3. Keep the specific stable model name in `GEMINI_MODEL`; do not use a moving `latest` alias in production.
4. Turn on `GEMINI_ENABLED` in a non-production environment and verify query fallback, evidence validation, latency, and cost telemetry.
5. Enable production only after the deterministic fallback and privacy review pass.

Official references: https://googleapis.github.io/js-genai/release_docs/ and https://ai.google.dev/gemini-api/docs/models

## Twilio WhatsApp operating modes

Loyal Loop has one provider-neutral WhatsApp boundary and two explicit Twilio
runtime modes. Business logic enqueues receipts, delivery updates, reminders,
and OTP requests without knowing which mode is active.

```env
# Allowed values: sandbox | production
TWILIO_WHATSAPP_MODE=sandbox

# Shared server-only credentials
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# Exact signed inbound and status-callback URL
TWILIO_WHATSAPP_WEBHOOK_URL=https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio
```

The callback URL is verified against the application route composition:

- Nest global prefix: `api/v1`
- controller prefix: `messaging`
- controller action: `webhooks/twilio`
- resulting route: `POST /api/v1/messaging/webhooks/twilio`

Twilio `X-Twilio-Signature` validation is mandatory in both modes and uses the
exact configured public URL. The non-sensitive runtime status is available at
`GET /api/v1/messaging/status` and returns only:

```json
{
  "whatsappMode": "sandbox",
  "messagingConfigured": true,
  "otpProvider": "internal-sandbox"
}
```

It never returns credentials, phone allow-lists, or SIDs.

The existing consent-aware test/send routes are mode-independent:

- `POST /api/v1/messaging/receipts/:id/send`
- `POST /api/v1/messaging/deliveries/:id/send`
- `POST /api/v1/messaging/reminders/:id/send` for an approved follow-up

The recipient must have the matching `RECEIPT`, `DELIVERY`, or `REMINDER`
consent, must not be suppressed, and must be eligible for the active Sandbox or
production allow-list before the outbox attempts delivery.

### A. Development with Twilio WhatsApp Sandbox

Sandbox mode is development/test-only. It runs locally by default. Because
deployment platforms commonly build pre-launch services with
`NODE_ENV=production`, such a service may explicitly opt in with
`TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX=true`. Without that value, startup fails
closed. The explicit override may use the live database; OTP digests retain the
same expiry, single-use, and attempt-limit controls.

1. In Twilio Console, activate the WhatsApp Sandbox.
2. From every test phone, send the displayed `join <sandbox-code>` message to
   the Sandbox number. A Sandbox recipient may need to rejoin after Twilio's
   enrollment window expires.
3. Record only those joined test numbers in E.164 format in
   `TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS`. Loyal Loop refuses to call Twilio
   for any other Sandbox recipient. Twilio error `63015` is also translated to
   a clear rejoin instruction if the local list becomes stale.
4. Add the shared Account SID and Auth Token to the development backend secret
   store. Do not add an `MG...`, `VA...`, or `HX...` SID in Sandbox mode.
5. Configure the exact webhook in the Twilio Sandbox page for inbound messages
   and status callbacks.
6. Enable only the local test runtime after the joined list is ready.

```env
TWILIO_WHATSAPP_MODE=sandbox
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_SANDBOX_FROM=whatsapp:+14155238886
TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS=+234...
TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX=false
TWILIO_WHATSAPP_WEBHOOK_URL=https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio

TWILIO_WHATSAPP_VERIFY_ENABLED=true
TWILIO_WHATSAPP_ENABLED=true
TWILIO_WHATSAPP_KILL_SWITCH=false
TWILIO_WHATSAPP_PRODUCTION_READY=false
TWILIO_WHATSAPP_DAILY_SEND_CAP=10
TWILIO_WHATSAPP_MAX_ATTEMPTS=4
MESSAGING_WORKER_SECRET=
```

For a production-built Render pre-launch service, use the same values above and
set the explicit runtime override:

```env
TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX=true
```

The override does not require changing `DATABASE_SAFETY_MODE`. Remove it when
the registered production sender is activated or before real customer traffic
is admitted.

Sandbox receipts, delivery updates, and reminders are sent as free-form text
prefixed with `[LOYAL LOOP DEVELOPMENT SANDBOX]`. Receipt and tracking messages
retain their real opaque application links. The test phone must keep an active
Sandbox conversation window for free-form delivery.

Sandbox OTP behavior is deliberately different from the old visible
development-code flow:

- the six-digit code is sent only through the WhatsApp Sandbox;
- the API response never returns it;
- the database stores a salted HMAC reference, never the raw code;
- existing ten-minute expiry, five-attempt limit, and single-use challenge
  behavior remain enforced by the owner/customer authentication services.

Business onboarding uses the same development-only Sandbox delivery through
`POST /api/v1/auth/onboarding/whatsapp/start` and
`POST /api/v1/auth/onboarding/whatsapp/verify`. The owner cannot leave the
business-details step until the exact WhatsApp number is verified. The
short-lived verification proof is claimed inside the registration transaction,
so it cannot be reused for a second account or for a different number.

Changing the business WhatsApp number later uses the authenticated owner-only
endpoints `POST /api/v1/businesses/current/contacts/whatsapp/start` and
`POST /api/v1/businesses/current/contacts/whatsapp/verify`. The replacement is
not published and does not change the owner sign-in identity until the exact
number has been verified. The proof is consumed in the same transaction as the
contact replacement. Managers can continue editing other social contacts but
cannot replace the owner's WhatsApp identity, and the personal-details endpoint
cannot bypass this verification path. `OWNER_PHONE_CHANGE_PROOF_MINUTES`
controls the bounded 5-to-60-minute proof window and defaults to 30 minutes.

Customers can separately opt into `DELIVERY` messages when they submit an
order request. After the seller confirms the request, and again when its
delivery status changes, Loyal Loop queues the delivery message with the real
opaque `/delivery/...` order-journey link. Missing consent suppresses the
message; a Twilio outage never rolls back the order or sale.

The Sandbox is not a production fallback. A production-built pre-launch runtime
must explicitly set the override above; all other production runtimes fail
startup when Sandbox mode is selected.

Official reference: https://www.twilio.com/docs/whatsapp/sandbox

### B. Production with Loyal Loop WhatsApp Sender

Production mode retains the complete registered-sender implementation. At
startup it requires valid-looking Account, Messaging Service, Verify Service,
registered sender, webhook, and all three approved Content Template values.
Missing or malformed values stop startup with environment-variable names only;
secret or complete SID values are never printed. There is no automatic fallback
to the Sandbox.

```env
TWILIO_WHATSAPP_MODE=production
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

TWILIO_WHATSAPP_SENDER=+234...
TWILIO_MESSAGING_SERVICE_SID=MG...
TWILIO_VERIFY_SERVICE_SID=VA...
TWILIO_RECEIPT_CONTENT_SID=HX...
TWILIO_DELIVERY_CONTENT_SID=HX...
TWILIO_REMINDER_CONTENT_SID=HX...

TWILIO_WHATSAPP_PILOT_ALLOWLIST=+234...
TWILIO_WHATSAPP_WEBHOOK_URL=https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio
TWILIO_WHATSAPP_VERIFY_ENABLED=false
TWILIO_WHATSAPP_ENABLED=false
TWILIO_WHATSAPP_KILL_SWITCH=true
TWILIO_WHATSAPP_PRODUCTION_READY=false
TWILIO_WHATSAPP_DAILY_SEND_CAP=25
TWILIO_WHATSAPP_MAX_ATTEMPTS=4
MESSAGING_WORKER_SECRET=
```

The previous `TWILIO_WHATSAPP_RECEIPT_CONTENT_SID` and
`TWILIO_WHATSAPP_DELIVERY_CONTENT_SID` names remain accepted as compatibility
aliases, but new environments should use the names above.

Production behavior:

- receipts use the registered sender, Messaging Service, and approved receipt
  Content SID;
- delivery updates use the registered sender, Messaging Service, and approved
  delivery Content SID, including the customer-safe order-journey link after
  an opted-in request is confirmed and on later delivery status changes;
- approved follow-up reminders use the registered sender, Messaging Service,
  and approved reminder Content SID;
- owner and customer OTP use the existing Twilio Verify WhatsApp Service;
- recipients remain restricted by the private-pilot allow-list;
- consent, STOP suppression, outbox idempotency, retries, daily cap, signed
  callbacks, and the kill switch remain active.

Production sequence:

1. Upgrade the company-controlled Twilio account.
2. Register the dedicated Loyal Loop number through WhatsApp Self Sign-up and
   complete Meta Business/WABA verification.
3. Attach the registered sender to the `MG...` Messaging Service and the
   WhatsApp Verify configuration.
4. Approve receipt, delivery, and reminder utility templates and store their
   `HX...` SIDs in the deployment secret store.
5. Configure the exact signed webhook and test inbound, delivery status, STOP,
   invalid signatures, retries, and failure alerts.
6. Add only pilot recipients, review pricing and spend controls, then set the
   enable/readiness flags and remove the kill switch as the final approval.

Official references: https://www.twilio.com/docs/verify/whatsapp,
https://www.twilio.com/docs/whatsapp/self-sign-up, and
https://www.twilio.com/docs/content/content-api-resources
