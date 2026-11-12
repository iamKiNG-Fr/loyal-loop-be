import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { secureDatabaseUrl } from "../../config/database-url";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = secureDatabaseUrl(
      configService.getOrThrow<string>("DATABASE_URL"),
    );

    // PRISMA_QUERY_LOG=1 prints one line per SQL statement with its duration,
    // for counting what a request costs. Off unless explicitly set.
    const logQueries = configService.get<string>("PRISMA_QUERY_LOG") === "1";
    super({
      ...(logQueries ? { log: [{ emit: "event" as const, level: "query" as const }] } : {}),
      adapter: new PrismaPg({ connectionString }),
      // Prisma's 5 s default is too tight for multi-step writes on a remote
      // database; a sale alone runs ~50 statements. Callers may still override.
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  private enableQueryLog() {
    (this as unknown as { $on(event: "query", handler: (e: { duration: number; query: string }) => void): void })
      .$on("query", (e) => {
        // Statement text only: parameters are never printed.
        console.log(`[sql] ${e.duration}ms ${e.query.replace(/\s+/g, " ").slice(0, 110)}`);
      });
  }

  async onModuleInit() {
    if (process.env.PRISMA_QUERY_LOG === "1") this.enableQueryLog();
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
