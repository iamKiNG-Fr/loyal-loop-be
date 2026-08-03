const BOOLEAN_VALUES = new Set(["true", "false"]);

export function validateEnvironment(input: Record<string, unknown>) {
  const config = { ...input };
  const environment = stringValue(config.NODE_ENV) || "development";
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  requireValue(config, "DATABASE_URL");
  validateBoolean(config, "ADMIN_PORTAL_ENABLED");
  validateBoolean(config, "ADMIN_ORIGIN_ENFORCED");
  validateBoolean(config, "ADMIN_PASSKEY_ENABLED");
  validateBoolean(config, "ADMIN_PASSKEY_REQUIRED");
  validateBoolean(config, "ADMIN_WHATSAPP_FALLBACK_ENABLED");
  validateBoolean(config, "CSRF_ENFORCED");
  validateBoolean(config, "DISCOVERY_SIGNED_EVENTS_REQUIRED");
  validateBoolean(config, "RATE_LIMIT_REDIS_ENABLED");

  if (environment !== "production") return config;

  const secrets = [
    requireSecret(config, "SESSION_HASH_SECRET"),
    requireSecret(config, "CSRF_SECRET"),
    requireSecret(config, "ANALYTICS_HMAC_SECRET"),
  ];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error("SESSION_HASH_SECRET, CSRF_SECRET, and ANALYTICS_HMAC_SECRET must be independent");
  }
  requireValue(config, "CSRF_ENFORCED");
  requireHttpsUrl(config, "APP_URL");

  const corsOrigins = parseOrigins(requireValue(config, "CORS_ORIGINS"), "CORS_ORIGINS");
  if (corsOrigins.some(isLocalOrigin)) {
    throw new Error("CORS_ORIGINS cannot include localhost in production");
  }

  const trustProxy = requireValue(config, "TRUST_PROXY");
  if (trustProxy === "true" || trustProxy === "false") {
    throw new Error("TRUST_PROXY must identify a trusted proxy hop count, subnet, or address in production");
  }

  if (stringValue(config.ADMIN_PORTAL_ENABLED) === "true") {
    const adminOrigins = parseOrigins(requireValue(config, "ADMIN_ORIGINS"), "ADMIN_ORIGINS");
    if (adminOrigins.some(isLocalOrigin)) {
      throw new Error("ADMIN_ORIGINS cannot include localhost in production");
    }
    if (adminOrigins.some((origin) => !corsOrigins.includes(origin))) {
      throw new Error("Every ADMIN_ORIGINS value must also be present in CORS_ORIGINS");
    }

    const passkeysEnabled = stringValue(config.ADMIN_PASSKEY_ENABLED) === "true";
    const whatsappFallbackEnabled =
      stringValue(config.ADMIN_WHATSAPP_FALLBACK_ENABLED) === "true";
    if (!passkeysEnabled && !whatsappFallbackEnabled) {
      throw new Error(
        "The admin portal requires passkeys or the WhatsApp fallback to remain enabled",
      );
    }
  }

  if (
    stringValue(config.ADMIN_PASSKEY_REQUIRED) === "true" &&
    stringValue(config.ADMIN_PASSKEY_ENABLED) !== "true"
  ) {
    throw new Error("ADMIN_PASSKEY_REQUIRED requires ADMIN_PASSKEY_ENABLED=true");
  }

  if (stringValue(config.ADMIN_PASSKEY_ENABLED) === "true") {
    const rpId = requireValue(config, "ADMIN_WEBAUTHN_RP_ID");
    const passkeyOrigins = parseOrigins(
      requireValue(config, "ADMIN_WEBAUTHN_ORIGINS"),
      "ADMIN_WEBAUTHN_ORIGINS",
    );
    if (passkeyOrigins.some((origin) => !origin.startsWith("https://"))) {
      throw new Error("ADMIN_WEBAUTHN_ORIGINS must use HTTPS in production");
    }
    if (passkeyOrigins.some((origin) => {
      const hostname = new URL(origin).hostname;
      return hostname !== rpId && !hostname.endsWith(`.${rpId}`);
    })) {
      throw new Error("ADMIN_WEBAUTHN_RP_ID must be the origin hostname or its registrable parent");
    }
  }

  if (stringValue(config.RATE_LIMIT_REDIS_ENABLED) === "true") {
    requireValue(config, "REDIS_URL");
  }

  return config;
}

function validateBoolean(config: Record<string, unknown>, name: string) {
  const value = stringValue(config[name]);
  if (value && !BOOLEAN_VALUES.has(value)) {
    throw new Error(`${name} must be true or false`);
  }
}

function requireSecret(config: Record<string, unknown>, name: string) {
  const value = requireValue(config, name);
  if (value.length < 32 || value.startsWith("replace-with-")) {
    throw new Error(`${name} must be an independent random secret of at least 32 characters`);
  }
  return value;
}

function requireHttpsUrl(config: Record<string, unknown>, name: string) {
  const value = requireValue(config, name);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS in production`);
  return value;
}

function requireValue(config: Record<string, unknown>, name: string) {
  const value = stringValue(config[name]);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
}

function parseOrigins(value: string, name: string) {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) throw new Error(`${name} must contain at least one exact origin`);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.pathname !== "/") {
      throw new Error(`${name} must contain exact origins without paths`);
    }
  }
  return origins;
}

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
