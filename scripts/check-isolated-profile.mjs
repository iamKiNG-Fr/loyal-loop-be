import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const profilePath = resolve(process.argv[2] ?? ".env.isolated.local");
const values = parseEnv(await readFile(profilePath, "utf8"));

const databaseUrl = required(values, "DATABASE_URL");
const safetyMode = required(values, "DATABASE_SAFETY_MODE");
const projectId = required(values, "NEON_PROJECT_ID");
const branchId = required(values, "NEON_BRANCH_ID");
const endpointId = required(values, "NEON_ENDPOINT_ID");
const nodeEnv = values.get("NODE_ENV")?.toLowerCase();

if (safetyMode !== "isolated") {
  fail("DATABASE_SAFETY_MODE must be isolated.");
}

if (nodeEnv === "production") {
  fail("The isolated profile cannot use NODE_ENV=production.");
}

const parsedUrl = new URL(databaseUrl);

if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
  fail("DATABASE_URL must be a PostgreSQL URL.");
}

if (!parsedUrl.hostname.startsWith(endpointId)) {
  fail("DATABASE_URL does not match the recorded isolated endpoint.");
}

for (const providerKey of [
  "RESEND_API_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
]) {
  if (values.get(providerKey)?.trim()) {
    fail(`${providerKey} must remain disabled in the isolated QA profile.`);
  }
}

const sharedValues = await readOptionalEnv(resolve(".env"));
const sharedDatabaseUrl = sharedValues.get("DATABASE_URL");

if (sharedDatabaseUrl && sharedDatabaseUrl === databaseUrl) {
  fail("The isolated profile still points to the shared DATABASE_URL.");
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const identity = await client.query(`
    SELECT
      current_database() AS database_name,
      current_setting('neon.branch_id', true) AS provider_branch_id,
      current_setting('transaction_read_only') AS transaction_read_only,
      to_regclass('public.businesses') IS NOT NULL AS has_businesses_table
  `);
  const row = identity.rows[0];

  if (row.provider_branch_id && row.provider_branch_id !== branchId) {
    fail("The connected provider branch does not match NEON_BRANCH_ID.");
  }

  if (!row.has_businesses_table) {
    fail("The isolated branch does not contain the expected Loyal Loop schema.");
  }

  const counts = await client.query(
    "SELECT count(*)::int AS business_count FROM public.businesses",
  );

  console.log("Isolated database profile verified.");
  console.log(`Project: ${projectId}`);
  console.log(`Branch: ${branchId}`);
  console.log(`Endpoint: ${endpointId}`);
  console.log(`Database: ${row.database_name}`);
  console.log(`Transaction mode: ${row.transaction_read_only}`);
  console.log(`Business rows: ${counts.rows[0].business_count}`);
} finally {
  await client.end();
}

function parseEnv(content) {
  const result = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

async function readOptionalEnv(path) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

function required(values, key) {
  const value = values.get(key)?.trim();

  if (!value) {
    fail(`${key} is required in the isolated profile.`);
  }

  return value;
}

function fail(message) {
  throw new Error(message);
}
