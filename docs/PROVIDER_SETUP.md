# Gemini and Twilio provider setup

The provider integrations are scaffolded and disabled by default. Keep every key in the backend environment only; none belongs in Nuxt public runtime configuration.

## Gemini

Loyal Loop uses the server-side `@google/genai` SDK for `parseDiscoveryQuery` and `summarizeCustomer`. Deterministic search and customer history remain available when Gemini is disabled or fails.

Required values:

```env
GEMINI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
GEMINI_TIMEOUT_MS=2500
```

Setup:

1. Create a Gemini Developer API key in Google AI Studio.
2. Store it as `GEMINI_API_KEY` in the backend service only.
3. Keep the specific stable model name in `GEMINI_MODEL`; do not use a moving `latest` alias in production.
4. Turn on `GEMINI_ENABLED` in a non-production environment and verify query fallback, evidence validation, latency, and cost telemetry.
5. Enable production only after the deterministic fallback and privacy review pass.

Official references: https://googleapis.github.io/js-genai/release_docs/ and https://ai.google.dev/gemini-api/docs/models

## Twilio Verify for WhatsApp OTP

Required values:

```env
CUSTOMER_OTP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_WHATSAPP_VERIFY_ENABLED=false
TWILIO_WHATSAPP_PILOT_ALLOWLIST=+234...
TWILIO_WHATSAPP_KILL_SWITCH=true
TWILIO_WHATSAPP_PRODUCTION_READY=false
```

Start with an upgraded company-owned Twilio account and a Verify Service. Test only allow-listed E.164 phone numbers. Activating the pilot requires `TWILIO_WHATSAPP_VERIFY_ENABLED=true` and `TWILIO_WHATSAPP_KILL_SWITCH=false`; production also requires `TWILIO_WHATSAPP_PRODUCTION_READY=true`. Do not change the production-readiness flag until sender ownership, consent, fallback, spend limits, and observability are approved.

Official reference: https://www.twilio.com/docs/verify/whatsapp

## Twilio WhatsApp utility messages

Additional values:

```env
TWILIO_WHATSAPP_ENABLED=false
TWILIO_WHATSAPP_SENDER=+1...
TWILIO_WHATSAPP_RECEIPT_CONTENT_SID=
TWILIO_WHATSAPP_DELIVERY_CONTENT_SID=
TWILIO_WHATSAPP_WEBHOOK_URL=https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio
TWILIO_WHATSAPP_DAILY_SEND_CAP=25
TWILIO_WHATSAPP_MAX_ATTEMPTS=4
MESSAGING_WORKER_SECRET=
```

Production sequence:

1. Upgrade the company-controlled Twilio account.
2. Register the dedicated phone number as a WhatsApp Sender through Twilio Self Sign-up and complete the Meta Business/WABA requirements.
3. Build and approve receipt and delivery utility templates, then copy their `HX...` Content SIDs into the backend environment.
4. Configure the exact public webhook URL and keep Twilio signature validation enabled.
5. Confirm purpose-scoped consent, STOP suppression, the pilot allow-list, outbox idempotency, retries, spend cap, fallback, alerts, and kill switch.
6. Test with `TWILIO_WHATSAPP_ENABLED=true` only in the private pilot. Remove the kill switch and set production readiness only as the final approval step.

The Twilio Sandbox is for isolated development recipients. A custom production sender and templates require the upgraded account and WhatsApp Sender registration.

Official references: https://www.twilio.com/docs/whatsapp/self-sign-up and https://www.twilio.com/docs/whatsapp/content-api
