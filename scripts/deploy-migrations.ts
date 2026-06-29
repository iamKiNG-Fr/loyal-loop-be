import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATION_LOCK = 72_707_369;

async function main() {
  const client = new Client({ connectionString: required("DATABASE_URL") });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    const failed = await client.query<{ migration_name: string }>(
      `SELECT migration_name
       FROM "_prisma_migrations"
       WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    if (failed.rowCount) {
      throw new Error(
        `Unresolved failed migration: ${failed.rows.map(row => row.migration_name).join(", ")}`,
      );
    }

    const applied = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    const appliedNames = new Set(applied.rows.map(row => row.migration_name));
    const migrationsRoot = join(process.cwd(), "prisma", "migrations");
    const entries = await readdir(migrationsRoot, { withFileTypes: true });
    const migrations = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    for (const migrationName of migrations) {
      if (appliedNames.has(migrationName)) {
        console.log(`Already applied: ${migrationName}`);
        continue;
      }

      const sql = await readFile(
        join(migrationsRoot, migrationName, "migration.sql"),
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");

      console.log(`Applying: ${migrationName}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
          [randomUUID(), checksum, migrationName],
        );
        await client.query("COMMIT");
      }
      catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Database migrations are up to date.");
  }
  finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    await client.end();
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
