export const OTP_PROVIDER = Symbol("OTP_PROVIDER");

export type OtpStartResult = {
  provider: string;
  reference: string;
  expiresAt: Date;
};

export interface OtpProvider {
  start(phone: string): Promise<OtpStartResult>;
  verify(reference: string, phone: string, code: string): Promise<boolean>;
}
