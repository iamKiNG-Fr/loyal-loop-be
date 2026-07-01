import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendWaitlistWelcomeEmail(params: {
    to: string;
    name: string;
    businessName: string;
    refCode: string;
  }) {
    if (!this.resend) {
      this.logger.warn("RESEND_API_KEY is not set. Skipping waitlist email.");
      return;
    }

    const appUrl = this.configService.get<string>(
      "APP_URL",
      "https://www.useloyalloop.com",
    );
    const from = this.configService.get<string>(
      "EMAIL_FROM",
      "Francis King <francis@mail.useloyalloop.com>",
    );
    const replyTo = this.configService.get<string>(
      "EMAIL_REPLY_TO",
      "support@useloyalloop.com",
    );
    const founderName = this.configService.get<string>(
      "FOUNDER_NAME",
      "Francis King",
    );
    const founderImageUrl = getEmailImageUrl(
      this.configService.get<string>("EMAIL_FOUNDER_IMAGE_URL"),
    );
    const logoUrl = getEmailImageUrl(
      this.configService.get<string>("EMAIL_LOGO_URL"),
    );
    const refLink = `${appUrl.replace(/\/$/, "")}/waitlist?code=${encodeURIComponent(params.refCode)}`;
    const safeName = escapeHtml(params.name);
    const safeBusinessName = escapeHtml(params.businessName);
    const safeFounderName = escapeHtml(founderName);
    const safeFounderInitials = escapeHtml(getInitials(founderName));
    const safeFounderImageUrl = founderImageUrl
      ? escapeHtml(founderImageUrl)
      : undefined;
    const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : undefined;
    const safeRefLink = escapeHtml(refLink);

    await this.resend.emails.send({
      from,
      to: params.to,
      replyTo,
      subject: `A quick note from ${founderName} at Loyal Loop`,
      html: buildWaitlistWelcomeEmail({
        name: safeName,
        businessName: safeBusinessName,
        founderName: safeFounderName,
        founderInitials: safeFounderInitials,
        founderImageUrl: safeFounderImageUrl,
        logoUrl: safeLogoUrl,
        refLink: safeRefLink,
      }),
      text: [
        `Hi ${params.name},`,
        "",
        `I am ${founderName}, the founder of Loyal Loop. Thank you for joining the waitlist for ${params.businessName}.`,
        "I am building Loyal Loop as a friendly trust engine for growing businesses: a simple way to remember customers, understand what they buy, and build stronger relationships from every sale.",
        "",
        "You earned 10 Trust Points.",
        "If you know another vendor, creator, or local brand owner who would find this useful, you can invite them with your link and earn more early access perks.",
        "",
        `Invite other business owners with your link: ${refLink}`,
        "",
        `- ${founderName}`,
      ].join("\n"),
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    name: string;
    token: string;
  }) {
    if (!this.resend) {
      this.logger.warn("RESEND_API_KEY is not set. Skipping password reset email.");
      return;
    }

    const appUrl = this.configService
      .get<string>("APP_URL", "https://www.useloyalloop.com")
      .replace(/\/$/, "");
    const resetUrl = `${appUrl}/auth/reset-password?token=${encodeURIComponent(params.token)}`;
    const from = this.configService.get<string>(
      "EMAIL_FROM",
      "Francis King <francis@mail.useloyalloop.com>",
    );

    await this.resend.emails.send({
      from,
      to: params.to,
      replyTo: this.configService.get<string>(
        "EMAIL_REPLY_TO",
        "support@useloyalloop.com",
      ),
      subject: "Reset your Loyal Loop password",
      text: `Hi ${params.name},\n\nReset your Loyal Loop password within 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hi ${escapeHtml(params.name)},</p><p>Use the link below within 30 minutes to reset your Loyal Loop password.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });
  }
}

function buildWaitlistWelcomeEmail(params: {
  name: string;
  businessName: string;
  founderName: string;
  founderInitials: string;
  founderImageUrl?: string;
  logoUrl?: string;
  refLink: string;
}) {
  const headerFounderAvatar = params.founderImageUrl
    ? `<img src="${params.founderImageUrl}" width="58" height="58" alt="${params.founderName}" style="display:block; width:58px; height:58px; border-radius:999px; border:2px solid rgba(255,255,255,0.7); object-fit:cover;">`
    : `<div style="width:58px; height:58px; border-radius:999px; border:2px solid rgba(255,255,255,0.7); background:rgba(255,255,255,0.18); color:#ffffff; font-family:'Space Grotesk','DM Sans',Arial,sans-serif; font-size:18px; line-height:58px; text-align:center; font-weight:800;">${params.founderInitials}</div>`;
  const signatureFounderAvatar = params.founderImageUrl
    ? `<img src="${params.founderImageUrl}" width="44" height="44" alt="${params.founderName}" style="display:block; width:44px; height:44px; border-radius:999px; object-fit:cover;">`
    : `<div style="width:44px; height:44px; border-radius:999px; background:#efeaff; color:#5D13E7; font-family:'Space Grotesk','DM Sans',Arial,sans-serif; font-size:14px; line-height:44px; text-align:center; font-weight:800;">${params.founderInitials}</div>`;
  const brandMark = params.logoUrl
    ? `<img src="${params.logoUrl}" width="112" alt="Loyal Loop" style="display:block; max-width:112px; height:auto; border:0;">`
    : "Loyal Loop";

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Welcome to Loyal Loop</title>
  </head>
  <body style="margin:0; padding:0; background:#FFFFF0; color:#333333;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
      A quick note from ${params.founderName}. You earned 10 Trust Points for joining Loyal Loop.
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFF0;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px; width:100%; background:#ffffff; border:1px solid #eee8ff; border-radius:28px; overflow:hidden; box-shadow:0 18px 48px rgba(93,19,231,0.12);">
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#5D13E7; background-image:linear-gradient(135deg,#5D13E7 0%,#3AB1C8 72%,#FFB44A 120%);">
                  <tr>
                    <td style="padding:30px 30px 34px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="vertical-align:middle;">
                            <div style="font-family:'DM Sans',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#FFFFF0;">
                              ${brandMark}
                            </div>
                          </td>
                          <td align="right" style="vertical-align:middle; width:72px;">
                            ${headerFounderAvatar}
                          </td>
                        </tr>
                      </table>
                      <h1 style="margin:18px 0 0; font-family:'Space Grotesk','DM Sans',Arial,sans-serif; font-size:34px; line-height:1.08; font-weight:700; color:#ffffff;">
                        You are on the Loyal Loop waitlist.
                      </h1>
                      <p style="margin:14px 0 0; max-width:500px; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.6; color:#F8FBFF;">
                        Thank you for being early. I am building this for businesses like yours.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:30px;">
                <p style="margin:0; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.65; color:#333333;">
                  Hi ${params.name},
                </p>
                <p style="margin:14px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.65; color:#333333;">
                  I am ${params.founderName}, the founder of Loyal Loop. Thank you for joining the waitlist for <strong>${params.businessName}</strong>.
                </p>
                <p style="margin:14px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.65; color:#333333;">
                  I am building Loyal Loop as a friendly trust engine for growing businesses: a simple way to remember customers, understand what they buy, and build stronger relationships from every sale.
                </p>
                <p style="margin:14px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.65; color:#333333;">
                  My goal is for vendors, creators, and local brands to feel like their customer relationships are easier to manage, warmer, and more valuable without turning the business into boring software.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0; background:#F9F9F9; border:1px solid #efeaff; border-radius:20px;">
                  <tr>
                    <td style="padding:22px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="vertical-align:top;">
                            <div style="font-family:'Space Grotesk','DM Sans',Arial,sans-serif; font-size:20px; line-height:1.2; font-weight:700; color:#333333;">
                              You earned 10 Trust Points.
                            </div>
                            <p style="margin:8px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.55; color:#5f5f68;">
                              As an early supporter, you will be closer to updates, early access, and launch perks.
                            </p>
                          </td>
                          <td align="right" style="vertical-align:top; width:96px;">
                            <div style="display:inline-block; padding:10px 14px; border-radius:999px; background:#fff7df; color:#5D13E7; font-family:'DM Sans',Arial,sans-serif; font-size:13px; font-weight:800; border:1px solid #FFE1A8;">
                              +10 points
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 12px; font-family:'Space Grotesk','DM Sans',Arial,sans-serif; font-size:17px; line-height:1.4; font-weight:700; color:#333333;">
                  Your invite link
                </p>
                <p style="margin:0 0 18px; font-family:'DM Sans',Arial,sans-serif; font-size:14px; line-height:1.55; color:#5f5f68;">
                  If you know another vendor, creator, or local brand owner who would find Loyal Loop useful, send them your invite link.
                </p>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:999px; background:#5D13E7; background-image:linear-gradient(135deg,#5D13E7,#3AB1C8);">
                      <a href="${params.refLink}" style="display:inline-block; padding:14px 22px; font-family:'DM Sans',Arial,sans-serif; font-size:15px; font-weight:800; color:#ffffff; text-decoration:none; border-radius:999px;">
                        Invite a business owner
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:18px 0 0; padding:14px 16px; background:#FFFFF0; border:1px solid #f0ead6; border-radius:14px; font-family:'DM Sans',Arial,sans-serif; font-size:13px; line-height:1.5; color:#5f5f68; word-break:break-word;">
                  ${params.refLink}
                </p>

                <p style="margin:26px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:16px; line-height:1.65; color:#333333;">
                  Thank you again for being early. It genuinely means a lot.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;">
                  <tr>
                    <td style="vertical-align:middle; padding-right:12px;">
                      ${signatureFounderAvatar}
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0; font-family:'DM Sans',Arial,sans-serif; font-size:15px; line-height:1.4; color:#333333; font-weight:800;">
                        ${params.founderName}
                      </p>
                      <p style="margin:2px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:13px; line-height:1.4; color:#77717f;">
                        Founder, Loyal Loop
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 30px 30px; border-top:1px solid #f0edf8;">
                <p style="margin:0; font-family:'DM Sans',Arial,sans-serif; font-size:13px; line-height:1.6; color:#77717f;">
                  Built for growing businesses that want customer memory, simple insight, and stronger repeat relationships without turning their shop into accounting software.
                </p>
                <p style="margin:16px 0 0; font-family:'DM Sans',Arial,sans-serif; font-size:12px; line-height:1.6; color:#9a95a3;">
                  Loyal Loop - useloyalloop.com
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getEmailImageUrl(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || !trimmedValue.startsWith("https://")) {
    return undefined;
  }

  return trimmedValue;
}

function getInitials(value: string) {
  const initials = value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "LL";
}
