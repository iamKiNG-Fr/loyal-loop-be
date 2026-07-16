import type { WhatsAppProvider } from "../messaging/whatsapp-provider";
import type { OtpProvider } from "./otp-provider";

/**
 * Keeps the existing provider-neutral authentication boundary while delegating
 * runtime selection to the shared WhatsApp provider. Production still uses
 * Twilio Verify; development Sandbox mode uses internally verified OTPs.
 */
export class TwilioVerifyProvider implements OtpProvider {
  constructor(private readonly whatsapp: WhatsAppProvider) {}

  start(phone: string) {
    return this.whatsapp.sendOtp(phone);
  }

  verify(reference: string, phone: string, code: string) {
    return this.whatsapp.verifyOtp(reference, phone, code);
  }
}
