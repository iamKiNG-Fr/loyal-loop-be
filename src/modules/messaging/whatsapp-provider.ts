export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");

export type WhatsAppMode = "sandbox" | "production";

export type WhatsAppProviderStatus = {
  whatsappMode: WhatsAppMode;
  messagingConfigured: boolean;
  otpProvider: "internal-sandbox" | "twilio-verify";
};

export type WhatsAppSendResult = {
  sid: string;
  status: string;
  provider: "twilio-whatsapp-sandbox" | "twilio-whatsapp-production";
};

export type WhatsAppOtpStartResult = {
  provider: "internal-sandbox" | "twilio-verify";
  reference: string;
  expiresAt: Date;
};

export type RecipientEligibility = {
  allowed: boolean;
  reason?: string;
};

export interface WhatsAppProvider {
  status(): WhatsAppProviderStatus;
  recipientEligibility(phone: string): RecipientEligibility;
  sendReceipt(
    phone: string,
    variables: Record<string, string>,
  ): Promise<WhatsAppSendResult>;
  sendDeliveryUpdate(
    phone: string,
    variables: Record<string, string>,
  ): Promise<WhatsAppSendResult>;
  sendReminder(
    phone: string,
    variables: Record<string, string>,
  ): Promise<WhatsAppSendResult>;
  sendOtp(phone: string): Promise<WhatsAppOtpStartResult>;
  verifyOtp(reference: string, phone: string, code: string): Promise<boolean>;
  sendMessage(phone: string, body: string): Promise<WhatsAppSendResult>;
}
