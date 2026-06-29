import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CustomerAuthController } from "./customer-auth.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { OTP_PROVIDER } from "./otp-provider";
import { TwilioVerifyProvider } from "./twilio-verify.provider";

@Module({
  controllers: [CustomerAuthController],
  providers: [
    CustomerAuthService,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new TwilioVerifyProvider(config),
    },
  ],
})
export class CustomerAuthModule {}
