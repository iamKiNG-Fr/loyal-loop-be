import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth, CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { CustomerAuthContext, OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import {
  ReviewPaymentProofDto,
  SubmitPaymentProofDto,
  UpsertPaymentAccountDto,
} from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

@Controller()
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
@Capabilities(BusinessCapability.PAYMENT_REVIEW)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("payment-account")
  paymentAccount(@CurrentAuth() auth: OwnerAuthContext) {
    return this.payments.paymentAccount(auth).then((data) => ok(data));
  }

  @Put("payment-account")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER", "MANAGER")
  upsertAccount(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpsertPaymentAccountDto,
  ) {
    return this.payments
      .upsertPaymentAccount(auth, dto)
      .then((data) => ok(data, "Payment account saved"));
  }

  @Delete("payment-account")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER", "MANAGER")
  removeAccount(@CurrentAuth() auth: OwnerAuthContext) {
    return this.payments
      .removePaymentAccount(auth)
      .then((data) => ok(data, "Payment account removed"));
  }

  @Get("payment-proofs")
  proofs(
    @CurrentAuth() auth: OwnerAuthContext,
    @Query("status") status?: string,
  ) {
    return this.payments.listProofs(auth, status).then((data) => ok(data));
  }

  @Patch("payment-proofs/:id")
  @Capabilities(BusinessCapability.PAYMENT_REVIEW)
  @Roles("OWNER", "MANAGER", "SALES")
  review(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: ReviewPaymentProofDto,
  ) {
    return this.payments
      .reviewProof(auth, id, dto)
      .then((data) => ok(data, "Payment proof reviewed"));
  }
}

@Controller("public/receipts")
@UseGuards(CustomerAuthGuard)
export class PublicReceiptPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":token/payment-proofs/signature")
  signature(@CurrentCustomer() customer: CustomerAuthContext, @Param("token") token: string) {
    return this.payments
      .createUploadSignature("receipt", customer.customerAccountId, token)
      .then((data) => ok(data));
  }

  @Post(":token/payment-proofs")
  submit(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.payments
      .submitProof("receipt", customer.customerAccountId, token, dto)
      .then((data) => ok(data, "Transfer proof submitted"));
  }
}

@Controller("public/deliveries")
@UseGuards(CustomerAuthGuard)
export class PublicDeliveryPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":token/payment-proofs/signature")
  signature(@CurrentCustomer() customer: CustomerAuthContext, @Param("token") token: string) {
    return this.payments
      .createUploadSignature("delivery", customer.customerAccountId, token)
      .then((data) => ok(data));
  }

  @Post(":token/payment-proofs")
  submit(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.payments
      .submitProof("delivery", customer.customerAccountId, token, dto)
      .then((data) => ok(data, "Transfer proof submitted"));
  }
}
