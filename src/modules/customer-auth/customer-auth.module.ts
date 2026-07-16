import { Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../messaging/whatsapp-provider";
import { CustomerAuthController } from "./customer-auth.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { OTP_PROVIDER } from "./otp-provider";
import { TwilioVerifyProvider } from "./twilio-verify.provider";

@Module({
  imports: [MessagingModule],
  controllers: [CustomerAuthController],
  providers: [
    CustomerAuthService,
    {
      provide: OTP_PROVIDER,
      inject: [WHATSAPP_PROVIDER],
      useFactory: (whatsapp: WhatsAppProvider) =>
        new TwilioVerifyProvider(whatsapp),
    },
  ],
  exports: [OTP_PROVIDER],
})
export class CustomerAuthModule {}
