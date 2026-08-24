const MERCHANT_ORIGIN_HOST = "useloyalloop.com";
const RESERVED_MERCHANT_LABELS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "cdn",
  "help",
  "mail",
  "status",
  "support",
  "www",
]);
const MERCHANT_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string[],
  environment?: string,
) {
  if (!origin || configuredOrigins.includes(origin)) return true;
  if (isMerchantOrigin(origin)) return true;
  if (environment === "production") return false;

  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isMerchantOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const suffix = `.${MERCHANT_ORIGIN_HOST}`;

    if (
      url.origin !== origin ||
      url.protocol !== "https:" ||
      url.port ||
      !url.hostname.endsWith(suffix)
    ) {
      return false;
    }

    const merchantLabel = url.hostname.slice(0, -suffix.length);

    return (
      !RESERVED_MERCHANT_LABELS.has(merchantLabel) &&
      MERCHANT_LABEL_PATTERN.test(merchantLabel)
    );
  } catch {
    return false;
  }
}
