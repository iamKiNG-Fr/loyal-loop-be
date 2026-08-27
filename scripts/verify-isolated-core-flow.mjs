import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;

const profile = parseEnv(await readFile(".env.isolated.local", "utf8"));

if (profile.get("DATABASE_SAFETY_MODE") !== "isolated") {
  throw new Error("The core-flow check requires DATABASE_SAFETY_MODE=isolated.");
}

if (profile.get("NODE_ENV") === "production") {
  throw new Error("The core-flow check cannot run with NODE_ENV=production.");
}

const port = profile.get("PORT") ?? "5101";
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const server = spawn(
  process.execPath,
  ["--env-file=.env.isolated.local", "./dist/main.js"],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
);

let serverErrors = "";
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
  serverOutput = serverOutput.slice(-8000);
});
server.stderr.on("data", (chunk) => {
  serverErrors += chunk.toString();
  serverErrors = serverErrors.slice(-4000);
});

try {
  await waitForServer();
  await runCoreFlow();
} finally {
  server.kill("SIGTERM");
}

async function runCoreFlow() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `batch-one-${suffix}@example.test`;
  const phone = `+23480${String(Date.now()).slice(-8)}`;
  const customerPhone = `+23481${String(Date.now()).slice(-8)}`;
  const emailVerificationChallengeId = randomUUID();
  const phoneVerificationChallengeId = randomUUID();
  let ownerCookie = "";
  let customerCookie = "";
  let ownerCsrfToken = "";
  let customerCsrfToken = "";

  const request = async (path, options = {}) => {
    const method = options.method ?? (options.body ? "POST" : "GET");
    const sessionCookie = options.public ? customerCookie : ownerCookie;
    const csrfToken = options.public ? customerCsrfToken : ownerCsrfToken;
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...(unsafe && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers ?? {}),
    };
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];

    if (setCookies.length) {
      const value = setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
      if (options.public) customerCookie = value;
      else ownerCookie = value;
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${payload?.message ?? "Unknown API error"}\n${sanitize(`${serverOutput}\n${serverErrors}`)}`,
      );
    }

    return payload?.data;
  };

  await createVerifiedOnboardingProofs({
    email,
    phone,
    emailVerificationChallengeId,
    phoneVerificationChallengeId,
  });

  await request("/auth/register", {
    body: {
      ownerName: "Batch One QA",
      email,
      password: `BatchOne-${suffix}!`,
      emailVerificationChallengeId,
      phoneVerificationChallengeId,
      businessName: `Batch One Isolated ${suffix}`,
      slug: `batch-one-${suffix}`,
      category: "QA",
      location: "Isolated Neon branch",
      contacts: [
        {
          platform: "WHATSAPP",
          value: phone,
          isPrimary: true,
        },
      ],
    },
  });
  assert(ownerCookie, "Registration did not establish an owner session.");
  ownerCsrfToken = (await request("/security/csrf"))?.token ?? "";
  assert(ownerCsrfToken, "Registration did not establish an owner CSRF token.");

  const identity = await request("/auth/me");
  assert(identity?.business?.id, "Owner identity is missing a business.");

  const customerResult = await request("/customers", {
    body: {
      name: "Batch One Customer",
      phone: customerPhone,
      email: `customer-${suffix}@example.test`,
      channel: "WHATSAPP",
      note: "Created by the isolated Batch 1 acceptance flow.",
      contacts: [{ platform: "WHATSAPP", value: customerPhone }],
    },
  });
  const customer = customerResult?.customer;
  assert(customer?.id, "Customer creation did not return an ID.");
  const customerSessionToken = await createCustomerSession({
    customerId: customer.id,
    phone: customerPhone,
  });
  customerCookie = `ll_customer_session=${customerSessionToken}`;
  customerCsrfToken = (await request("/security/csrf", { public: true }))?.token ?? "";
  assert(customerCsrfToken, "Customer verification did not establish a CSRF token.");

  const product = await request("/products", {
    body: {
      name: "Batch One Product",
      price: "2500.00",
      currency: "NGN",
      stockCount: 5,
    },
  });
  assert(product?.id, "Product creation did not return an ID.");

  const saleResult = await request("/sales", {
    headers: { "Idempotency-Key": `batch-one-${suffix}` },
    body: {
      customerId: customer.id,
      channel: "WHATSAPP",
      fulfillment: "DELIVERY",
      paymentMethod: "ARRANGE_SEPARATELY",
      amountPaid: "0",
      deliveryAddress: "Isolated QA address",
      deliveryNotes: "Batch 1 acceptance delivery",
      items: [
        {
          productId: product.id,
          name: product.name,
          quantity: 1,
          unitPrice: "2500.00",
        },
      ],
    },
  });
  assert(saleResult?.sale?.id, "Sale creation did not return a sale.");
  assert(saleResult?.sale?.receipt?.id, "Sale creation did not return a receipt.");
  assert(saleResult?.sale?.delivery?.id, "Sale creation did not return a delivery.");
  assert(saleResult?.receiptToken, "Sale creation did not return a receipt token.");
  assert(saleResult?.deliveryToken, "Sale creation did not return a delivery token.");

  await request(`/public/receipts/${saleResult.receiptToken}`, { public: true });
  await request(`/public/receipts/${saleResult.receiptToken}/acknowledge`, {
    method: "POST",
    public: true,
  });
  await request(`/public/deliveries/${saleResult.deliveryToken}`, { public: true });
  await request(`/deliveries/${saleResult.sale.delivery.id}`, {
    method: "PATCH",
    body: {
      status: "READY_FOR_PICKUP",
      note: "Order packed and ready for dispatch",
    },
  });
  await request(`/deliveries/${saleResult.sale.delivery.id}`, {
    method: "PATCH",
    body: {
      status: "IN_TRANSIT",
      courierService: "Isolated QA Dispatch",
      courierName: "Batch One Rider",
      courierPhone: customerPhone,
      note: "Rider collected the order",
    },
  });
  await request(`/deliveries/${saleResult.sale.delivery.id}`, {
    method: "PATCH",
    body: {
      status: "DELIVERED",
      note: "Rider arrived with the customer",
    },
  });
  const deliveryAtHandoff = await request(
    `/public/deliveries/${saleResult.deliveryToken}`,
    { public: true },
  );
  assert(
    /^\d{6}$/.test(deliveryAtHandoff?.handoffCode ?? ""),
    "Shop delivery did not issue a six-digit handoff code.",
  );
  await request(`/deliveries/${saleResult.sale.delivery.id}/confirm-handoff`, {
    body: { code: deliveryAtHandoff.handoffCode },
  });
  await request(`/public/deliveries/${saleResult.deliveryToken}/confirm`, {
    method: "POST",
    public: true,
  });

  const template = await request("/follow-ups/templates", {
    body: {
      name: "Batch One Thank You",
      body: "Thank you for shopping with us.",
    },
  });
  assert(template?.id, "Follow-up template creation did not return an ID.");

  const suggestion = await request("/follow-ups/suggestions", {
    body: {
      customerId: customer.id,
      templateId: template.id,
      reason: "Verify the sale-to-follow-up acceptance spine.",
    },
  });
  assert(suggestion?.id, "Follow-up suggestion creation did not return an ID.");

  await request(`/follow-ups/suggestions/${suggestion.id}/approve`, {
    method: "POST",
  });
  await request(`/follow-ups/suggestions/${suggestion.id}/complete`, {
    method: "POST",
  });

  const timeline = await request(`/customers/${customer.id}/timeline`);
  assert(Array.isArray(timeline), "Customer timeline was not returned.");
  await request("/dashboard");

  console.log("Isolated core flow verified with verified email and WhatsApp onboarding proofs.");
  console.log("verified registration -> customer -> product -> sale -> receipt -> merchant delivery journey -> handoff code -> customer confirmation -> follow-up -> dashboard");
}

async function createVerifiedOnboardingProofs({
  email,
  phone,
  emailVerificationChallengeId,
  phoneVerificationChallengeId,
}) {
  const connectionString = profile.get("DATABASE_URL");
  assert(connectionString, "The isolated profile is missing DATABASE_URL.");

  const client = new Client({ connectionString });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);

  await client.connect();
  try {
    await client.query(
      `INSERT INTO "onboarding_email_challenges"
        ("id", "email", "codeHash", "expiresAt", "verifiedAt", "attempts", "createdAt")
       VALUES ($1, $2, $3, $4, $5, 0, $5)`,
      [
        emailVerificationChallengeId,
        email,
        "isolated-core-verifier",
        expiresAt,
        now,
      ],
    );
    await client.query(
      `INSERT INTO "owner_otp_challenges"
        ("id", "phone", "provider", "providerReference", "expiresAt", "verifiedAt", "attempts", "purpose", "createdAt")
       VALUES ($1, $2, 'isolated-core-verifier', $3, $4, $5, 0, 'ONBOARDING', $5)`,
      [
        phoneVerificationChallengeId,
        phone,
        `isolated-core:${phoneVerificationChallengeId}`,
        expiresAt,
        now,
      ],
    );
  } finally {
    await client.end();
  }
}

async function createCustomerSession({ customerId, phone }) {
  const connectionString = profile.get("DATABASE_URL");
  assert(connectionString, "The isolated profile is missing DATABASE_URL.");

  const client = new Client({ connectionString });
  const customerAccountId = randomUUID();
  const rawToken = `${randomUUID()}${randomUUID()}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "customer_accounts"
        ("id", "phone", "verifiedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3, $3)`,
      [customerAccountId, phone, now],
    );
    await client.query(
      `UPDATE "customers" SET "accountId" = $1, "updatedAt" = $2 WHERE "id" = $3`,
      [customerAccountId, now, customerId],
    );
    await client.query(
      `INSERT INTO "customer_account_sessions"
        ("id", "customerAccountId", "tokenHash", "expiresAt", "lastUsedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [randomUUID(), customerAccountId, tokenHash, expiresAt, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  return rawToken;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Isolated API exited before startup. ${sanitize(serverErrors)}`);
    }

    try {
      const response = await fetch(`${baseUrl}/auth/me`);

      if (response.status > 0) {
        return;
      }
    } catch {
      // The isolated API is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Isolated API did not start within 30 seconds. ${sanitize(serverErrors)}`);
}

function parseEnv(content) {
  const result = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitize(value) {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/npg_[A-Za-z0-9_-]+/g, "[REDACTED_PASSWORD]")
    .trim();
}
