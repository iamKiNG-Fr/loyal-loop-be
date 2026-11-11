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

    super({
      adapter: new PrismaPg({ connectionString }),
      // Prisma's 5 s default is too tight for multi-step writes on a remote
      // database; a sale alone runs ~50 statements. Callers may still override.
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
