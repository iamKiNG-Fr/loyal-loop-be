const text = (value: unknown, max = 240) => typeof value === "string" ? value.slice(0, max) : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const channels = ["whatsapp", "instagram", "facebook", "tiktok", "snapchat", "walk-in", "website", "other"];
const paymentMethods = ["BANK_TRANSFER", "PAY_ON_DELIVERY", "CASH", "ARRANGE_SEPARATELY"];

/** Never persist credentials, OTPs, verification proofs, media or arbitrary client keys. */
export function safeOnboardingForm(value: unknown) {
  const form = object(value);
  const methods = paymentMethods.filter(method => Array.isArray(form.allowedPaymentMethods) && form.allowedPaymentMethods.includes(method));
  const selected = channels.filter(channel => Array.isArray(form.channels) && form.channels.includes(channel));
  const socials = object(form.socialAccounts);
  return {
    ownerName: text(form.ownerName, 100), email: text(form.email, 254),
    businessName: text(form.businessName, 120), category: text(form.category, 100), categoryDetail: text(form.categoryDetail, 160),
    location: text(form.location, 160), contact: text(form.contact, 40), slug: text(form.slug, 80),
    countryCode: ["NG", "GH", "KE", "ZA"].includes(String(form.countryCode)) ? form.countryCode : "NG",
    channel: channels.includes(String(form.channel)) ? form.channel : "whatsapp",
    channels: selected.length ? selected : ["whatsapp"],
    instagram: text(form.instagram),
    socialAccounts: Object.fromEntries(channels.filter(channel => channel !== "walk-in").map(channel => [channel, text(socials[channel])])),
    theme: ["purple", "midnight", "fresh", "blush"].includes(String(form.theme)) ? form.theme : "purple",
    signature: text(form.signature, 100), pledged: form.pledged === true,
    allowedPaymentMethods: methods.length ? methods : ["ARRANGE_SEPARATELY"],
    defaultPaymentMethod: methods.includes(String(form.defaultPaymentMethod)) ? form.defaultPaymentMethod : "",
  };
}
