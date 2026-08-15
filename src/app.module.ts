import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { SecurityModule } from "./common/auth/security.module";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { ActivityModule } from "./modules/activity/activity.module";
import { AttentionModule } from "./modules/attention/attention.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BusinessesModule } from "./modules/businesses/businesses.module";
import { CustomerAuthModule } from "./modules/customer-auth/customer-auth.module";
import { CustomerReportsModule } from "./modules/customer-reports/customer-reports.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { CartsModule } from "./modules/carts/carts.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DeliveryModule } from "./modules/delivery/delivery.module";
import { DiscoveryModule } from "./modules/discovery/discovery.module";
import { FollowUpsModule } from "./modules/follow-ups/follow-ups.module";
import { MailModule } from "./modules/mail/mail.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { MediaModule } from "./modules/media/media.module";
import { IntelligenceModule } from "./modules/intelligence/intelligence.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProductsModule } from "./modules/products/products.module";
import { PromotionsModule } from "./modules/promotions/promotions.module";
import { ReceiptsModule } from "./modules/receipts/receipts.module";
import { SalesModule } from "./modules/sales/sales.module";
import { ShopsModule } from "./modules/shops/shops.module";
import { ShortLinksModule } from "./modules/short-links/short-links.module";
import { SupportModule } from "./modules/support/support.module";
import { TrustModule } from "./modules/trust/trust.module";
import { UsersModule } from "./modules/users/users.module";
import { WaitlistModule } from "./modules/waitlist/waitlist.module";
import { FoundingCircleModule } from "./modules/founding-circle/founding-circle.module";
import { FoundingValueFeedbackModule } from "./modules/founding-value-feedback/founding-value-feedback.module";
import { PlatformAuthModule } from "./modules/platform-auth/platform-auth.module";
import { PlatformAdminModule } from "./modules/platform-admin/platform-admin.module";
import { PwaTelemetryModule } from "./modules/pwa-telemetry/pwa-telemetry.module";
import { validateEnvironment } from "./config/environment";
import { CsrfGuard } from "./common/auth/csrf.guard";
import { RedisThrottlerStorage } from "./common/redis-throttler.storage";
import { hmacPrivateValue } from "./common/crypto.util";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const storage = configService.get("RATE_LIMIT_REDIS_ENABLED") === "true"
          ? await RedisThrottlerStorage.connect(configService.getOrThrow<string>("REDIS_URL"))
          : undefined;
        const accountSecret =
          configService.get<string>("SESSION_HASH_SECRET") ||
          "development-rate-limit";
        return {
          storage,
          throttlers: [
            {
              name: "default",
              ttl: getPositiveNumber(configService, "RATE_LIMIT_TTL_MS", 60000),
              limit: getPositiveNumber(configService, "RATE_LIMIT_MAX", 100),
            },
            {
              name: "login-account",
              ttl: 15 * 60 * 1000,
              limit: 8,
              blockDuration: 15 * 60 * 1000,
              skipIf: (context) => !context.switchToHttp().getRequest().originalUrl?.endsWith("/auth/login"),
              getTracker: (request) => hmacPrivateValue(
                String(request.body?.email ?? "missing").trim().toLowerCase(),
                accountSecret,
              ),
            },
            {
              name: "admin-login-identity",
              ttl: 15 * 60 * 1000,
              limit: 8,
              blockDuration: 15 * 60 * 1000,
              skipIf: (context) => !/\/platform-auth\/(?:step-up\/start|passkeys\/authentication\/options)(?:\?|$)/.test(
                context.switchToHttp().getRequest().originalUrl ?? "",
              ),
              getTracker: (request) => hmacPrivateValue(
                String(request.body?.identifier ?? "missing").trim().toLowerCase(),
                accountSecret,
              ),
            },
            {
              name: "discovery-events",
              ttl: 60 * 1000,
              limit: 30,
              blockDuration: 5 * 60 * 1000,
              skipIf: (context) => !/\/(public\/discovery|customer-discovery)\/events(?:\?|$)/.test(
                context.switchToHttp().getRequest().originalUrl ?? "",
              ),
            },
            {
              name: "otp-target",
              ttl: 15 * 60 * 1000,
              limit: 5,
              blockDuration: 15 * 60 * 1000,
              skipIf: (context) => !/\/whatsapp\/start(?:\?|$)/.test(
                context.switchToHttp().getRequest().originalUrl ?? "",
              ),
              getTracker: (request) => hmacPrivateValue(
                String(request.body?.phone ?? "missing").replace(/\D/g, ""),
                accountSecret,
              ),
            },
            {
              name: "otp-challenge",
              ttl: 15 * 60 * 1000,
              limit: 10,
              blockDuration: 15 * 60 * 1000,
              skipIf: (context) => !/\/(?:whatsapp|step-up)\/verify(?:\?|$)/.test(
                context.switchToHttp().getRequest().originalUrl ?? "",
              ),
              getTracker: (request) => hmacPrivateValue(
                String(request.body?.challengeId ?? "missing"),
                accountSecret,
              ),
            },
          ],
        };
      },
    }),
    PrismaModule,
    IntelligenceModule,
    SecurityModule,
    MailModule,
    MessagingModule,
    AttentionModule,
    WaitlistModule,
    FoundingCircleModule,
    FoundingValueFeedbackModule,
    PlatformAuthModule,
    PlatformAdminModule,
    PwaTelemetryModule,
    AuthModule,
    CustomerAuthModule,
    CustomerReportsModule,
    BusinessesModule,
    UsersModule,
    MediaModule,
    PaymentsModule,
    CustomersModule,
    CartsModule,
    PromotionsModule,
    ProductsModule,
    SalesModule,
    ReceiptsModule,
    DeliveryModule,
    DiscoveryModule,
    ActivityModule,
    FollowUpsModule,
    ShopsModule,
    ShortLinksModule,
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
      provide: APP_GUARD,
      useClass: CsrfGuard,
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
