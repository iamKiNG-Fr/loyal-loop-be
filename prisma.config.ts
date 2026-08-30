import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { secureDatabaseUrl } from "./src/config/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: secureDatabaseUrl(process.env.DATABASE_URL_UNPOOLED || env("DATABASE_URL")),
  },
});
