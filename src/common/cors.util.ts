export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string[],
  environment?: string,
) {
  if (!origin || configuredOrigins.includes(origin)) return true;
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
