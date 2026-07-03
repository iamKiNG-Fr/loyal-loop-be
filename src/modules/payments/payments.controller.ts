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
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import {
  ReviewPaymentProofDto,
  SubmitPaymentProofDto,
  UpsertPaymentAccountDto,
} from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

@Controller()
@UseGuards(OwnerAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("payment-account")
  paymentAccount(@CurrentAuth() auth: OwnerAuthContext) {
    return this.payments.paymentAccount(auth).then((data) => ok(data));
  }

  @Put("payment-account")
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
export class PublicReceiptPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":token/payment-proofs/signature")
  signature(@Param("token") token: string) {
    return this.payments
      .createUploadSignature("receipt", token)
      .then((data) => ok(data));
  }

  @Post(":token/payment-proofs")
  submit(
    @Param("token") token: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.payments
      .submitProof("receipt", token, dto)
      .then((data) => ok(data, "Transfer proof submitted"));
  }
}

@Controller("public/deliveries")
export class PublicDeliveryPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":token/payment-proofs/signature")
  signature(@Param("token") token: string) {
    return this.payments
      .createUploadSignature("delivery", token)
      .then((data) => ok(data));
  }

  @Post(":token/payment-proofs")
  submit(
    @Param("token") token: string,
    @Body() dto: SubmitPaymentProofDto,
  ) {
    return this.payments
      .submitProof("delivery", token, dto)
      .then((data) => ok(data, "Transfer proof submitted"));
  }
}
