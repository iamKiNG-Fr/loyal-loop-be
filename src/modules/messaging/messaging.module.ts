import { Global, Module } from "@nestjs/common";
import { ActivityModule } from "../activity/activity.module";
import { MessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { TwilioWhatsAppProvider } from "./twilio-whatsapp.provider";
import { WHATSAPP_PROVIDER } from "./whatsapp-provider";

@Global()
@Module({
  imports: [ActivityModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    {
      provide: WHATSAPP_PROVIDER,
      useClass: TwilioWhatsAppProvider,
    },
  ],
  exports: [MessagingService, WHATSAPP_PROVIDER],
})
export class MessagingModule {}
