import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth, CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { CustomerAuthContext, OwnerAuthContext } from "../../common/request-context";
import { CreateReceiptIssueDto, UpdateReceiptDto } from "./dto/receipt.dto";
import { ReceiptsService } from "./receipts.service";

@Controller("receipts")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.receipts.list(auth).then((data) => ok(data));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.receipts.get(auth, id).then((data) => ok(data));
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER", "SALES")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateReceiptDto,
  ) {
    return this.receipts.update(auth, id, dto).then((data) => ok(data, "Receipt updated"));
  }

  @Post(":id/sent")
  @Roles("OWNER", "MANAGER", "SALES")
  sent(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.receipts.markSent(auth, id).then((data) => ok(data, "Receipt marked sent"));
  }

  @Post(":id/share-link")
  @Roles("OWNER", "MANAGER", "SALES")
  shareLink(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.receipts
      .createShareLink(auth, id)
      .then((data) => ok(data, "Receipt share link created"));
  }
}

@Controller("public/receipts")
@UseGuards(CustomerAuthGuard)
export class PublicReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(":token")
  get(@CurrentCustomer() customer: CustomerAuthContext, @Param("token") token: string) {
    return this.receipts.getPublic(customer.customerAccountId, token).then((data) => ok(data));
  }

  @Post(":token/acknowledge")
  acknowledge(@CurrentCustomer() customer: CustomerAuthContext, @Param("token") token: string) {
    return this.receipts
      .acknowledge(customer.customerAccountId, token)
      .then((data) => ok(data, "Receipt acknowledged"));
  }

  @Post(":token/issues")
  issue(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
    @Body() dto: CreateReceiptIssueDto,
  ) {
    return this.receipts
      .createIssue(customer.customerAccountId, token, dto)
      .then((data) => ok(data, "Issue submitted"));
  }
}

@Controller("public/receipt-media")
export class PublicReceiptMediaController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(":id")
  get(
    @Param("id") id: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
  ) {
    return this.receipts.getMessagePreview(id, Number(expires), signature).then((data) => ok(data));
  }
}
