import { Body, Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { CustomerAuthContext, OwnerAuthContext } from "../../common/request-context";
import { MessagingConsentDto } from "./dto/messaging.dto";
import { MessagingService } from "./messaging.service";

@Controller("messaging")
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get("consents")
  @UseGuards(CustomerAuthGuard)
  consents(@CurrentCustomer() customer: CustomerAuthContext) {
    return this.messaging.consentState(customer.customerAccountId).then((data) => ok(data));
  }

  @Post("consents")
  @UseGuards(CustomerAuthGuard)
  grant(@CurrentCustomer() customer: CustomerAuthContext, @Body() dto: MessagingConsentDto) {
    return this.messaging.grantConsent(customer.customerAccountId, dto.purpose).then((data) => ok(data, "WhatsApp consent saved"));
  }

  @Delete("consents")
  @UseGuards(CustomerAuthGuard)
  revoke(@CurrentCustomer() customer: CustomerAuthContext, @Body() dto: MessagingConsentDto) {
    return this.messaging.revokeConsent(customer.customerAccountId, dto.purpose).then((data) => ok(data, "WhatsApp consent revoked"));
  }

  @Post("internal/process")
  async process(@Headers("x-messaging-worker-secret") secret: string | undefined) {
    this.messaging.assertWorkerSecret(secret);
    return ok(await this.messaging.processDue(), "Messaging outbox processed");
  }

  @Post("receipts/:id/send")
  @UseGuards(OwnerAuthGuard, CapabilitiesGuard)
  @Capabilities("SALE_READ")
  sendReceipt(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.messaging.enqueueReceipt(auth, id).then((data) => ok(data, "Receipt queued for WhatsApp"));
  }

  @Post("deliveries/:id/send")
  @UseGuards(OwnerAuthGuard, CapabilitiesGuard)
  @Capabilities("DELIVERY_WRITE")
  sendDelivery(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.messaging.enqueueDelivery(auth, id).then((data) => ok(data, "Delivery update queued for WhatsApp"));
  }

  @Post("webhooks/twilio")
  async webhook(
    @Headers("x-twilio-signature") signature: string | undefined,
    @Req() request: Request,
  ) {
    return this.messaging.handleTwilioWebhook(signature, request.body as Record<string, string | undefined>);
  }
}
