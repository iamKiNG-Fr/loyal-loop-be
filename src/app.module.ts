import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { SecurityModule } from "./common/auth/security.module";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { ActivityModule } from "./modules/activity/activity.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BusinessesModule } from "./modules/businesses/businesses.module";
import { CustomerAuthModule } from "./modules/customer-auth/customer-auth.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DeliveryModule } from "./modules/delivery/delivery.module";
import { FollowUpsModule } from "./modules/follow-ups/follow-ups.module";
import { MailModule } from "./modules/mail/mail.module";
import { MediaModule } from "./modules/media/media.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProductsModule } from "./modules/products/products.module";
import { ReceiptsModule } from "./modules/receipts/receipts.module";
import { SalesModule } from "./modules/sales/sales.module";
import { ShopsModule } from "./modules/shops/shops.module";
import { SupportModule } from "./modules/support/support.module";
import { TrustModule } from "./modules/trust/trust.module";
import { UsersModule } from "./modules/users/users.module";
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
    SecurityModule,
    MailModule,
    WaitlistModule,
    AuthModule,
    CustomerAuthModule,
    BusinessesModule,
    UsersModule,
    MediaModule,
    CustomersModule,
    ProductsModule,
    SalesModule,
    ReceiptsModule,
    DeliveryModule,
    ActivityModule,
    FollowUpsModule,
    ShopsModule,
    DashboardModule,
    TrustModule,
    SupportModule,
    BillingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
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
