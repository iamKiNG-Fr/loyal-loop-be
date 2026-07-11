import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

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
  let ownerCookie = "";

  const request = async (path, options = {}) => {
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(ownerCookie && !options.public ? { Cookie: ownerCookie } : {}),
      ...(options.headers ?? {}),
    };
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];

    if (setCookies.length) {
      ownerCookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      throw new Error(
        `${options.method ?? (options.body ? "POST" : "GET")} ${path} failed with ${response.status}: ${payload?.message ?? "Unknown API error"}\n${sanitize(`${serverOutput}\n${serverErrors}`)}`,
      );
    }

    return payload?.data;
  };

  await request("/auth/register", {
    body: {
      ownerName: "Batch One QA",
      email: `batch-one-${suffix}@example.test`,
      password: `BatchOne-${suffix}!`,
      businessName: `Batch One Isolated ${suffix}`,
      slug: `batch-one-${suffix}`,
      category: "QA",
      location: "Isolated Neon branch",
    },
  });
  assert(ownerCookie, "Registration did not establish an owner session.");

  const identity = await request("/auth/me");
  assert(identity?.business?.id, "Owner identity is missing a business.");

  const customerResult = await request("/customers", {
    body: {
      name: "Batch One Customer",
      email: `customer-${suffix}@example.test`,
      channel: "WHATSAPP",
      note: "Created by the isolated Batch 1 acceptance flow.",
    },
  });
  const customer = customerResult?.customer;
  assert(customer?.id, "Customer creation did not return an ID.");

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

  console.log("Isolated core flow verified.");
  console.log("registration -> customer -> product -> sale -> receipt -> delivery -> follow-up -> dashboard");
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
