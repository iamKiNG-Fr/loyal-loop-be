# WhatsApp copy refresh — Batch 75

Source: Loyal Loop Issues Google Doc, page 1 report 3, reviewed 14 September 2026.

Messages should read like a useful shop conversation: a short greeting, a factual update, one next action and a separate link or button. Avoid long paragraphs, repeated Loyal Loop labels, vague status claims and phrases such as “stay with the journey”. Keep order references, invitation expiry, quote-reply instructions, verification and STOP/SKIP controls where relevant.

Manual customer nudges, delivery/balance reminders, invitation copy and app-generated WhatsApp share links now follow this pattern. Development Sandbox receipt, order, delivery, reminder, owner digest, invitation and customer-memory messages use matching paragraph structure. Receipt creation alone never implies payment confirmation. Custom merchant-authored follow-up templates remain merchant content; the existing short default thank-you/arrival/restock messages already fit this direction.

## Production template drafts — not activated

Production text and buttons live in Twilio/WhatsApp Content templates. Changing local Sandbox code does not revise an approved Content SID. The contracts in `PROVIDER_SETUP.md` still describe the current configured versions. The following replacement copy is prepared for provider review; retain their variable maps, secure URL/media fields, classification and send/consent gates. Do not activate new SIDs before approval and a controlled recipient acceptance check.

**Receipt** (button: View receipt)

```text
Hi {{1}} 👋

Your receipt from {{2}} is ready.
Receipt {{3}}

Open it below whenever you need it.
```

**Order and delivery update** (button: View order)

```text
Hi {{1}} 👋

{{2}} · Order {{3}}
{{4}}

See the latest update below.
```

**Customer memory** (keep the existing quote-reply guide image)

```text
Hi {{1}} 👋
{{2}}'s delivery is confirmed ✅

Anything to remember for next time?

Press and hold this message, tap Reply, then add a quick customer note.
Reply SKIP if there is nothing to save.
```

**Owner digest** (button: Open today's tasks)

```text
Morning {{1}} 👋

Here's today at {{2}}:
{{3}}

Reply STOP to stop these updates.
```

**Founding Circle invitation** (button: Set up your shop)

```text
Hi {{1}} 👋

You're invited! Bring {{2}} into the Loyal Loop Founding Circle.

Set up your shop before {{4}}.
If now isn’t the right time, no action is needed.
```

The reminder contract uses the recipient name, shop name and actual reminder text: keep those facts in separate paragraphs. Authentication codes retain the current expiry and anti-sharing warning; do not add playful ambiguity to security messages. Production formatting remains an explicit external blocker for the source report until replacement templates are approved and activated. No template submission, provider configuration or live message send occurred in Batch 75.
