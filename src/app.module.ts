import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { MailModule } from "./modules/mail/mail.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { WaitlistModule } from "./modules/waitlist/waitlist.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: getPositiveNumber(configService, "RATE_LIMIT_TTL_MS", 60000),
          limit: getPositiveNumber(configService, "RATE_LIMIT_MAX", 100),
        },
      ],
    }),
    PrismaModule,
    MailModule,
    WaitlistModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

function getPositiveNumber(
  configService: ConfigService,
  key: string,
  fallback: number,
) {
  const value = Number(configService.get<string | number>(key));

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
