import { ConfigService } from "@nestjs/config";

/** Optional sender identities; blank overrides preserve the currently configured sender. */
export function mailSender(config: ConfigService, purpose: "SECURITY" | "UPDATES" | "FOUNDER") {
  const current = config.get<string>("EMAIL_FROM")?.trim() || "Francis King <francis@mail.useloyalloop.com>";
  return {
    from: (purpose === "FOUNDER" ? undefined : config.get<string>(`EMAIL_${purpose}_FROM`)?.trim()) || current,
    replyTo: (purpose === "FOUNDER" ? undefined : config.get<string>(`EMAIL_${purpose}_REPLY_TO`)?.trim())
      || config.get<string>("EMAIL_REPLY_TO")?.trim() || "support@useloyalloop.com",
  };
}
