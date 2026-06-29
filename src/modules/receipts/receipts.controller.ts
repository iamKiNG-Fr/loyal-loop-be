import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
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
}

@Controller("public/receipts")
export class PublicReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(":token")
  get(@Param("token") token: string) {
    return this.receipts.getPublic(token).then((data) => ok(data));
  }

  @Post(":token/acknowledge")
  acknowledge(@Param("token") token: string) {
    return this.receipts
      .acknowledge(token)
      .then((data) => ok(data, "Receipt acknowledged"));
  }

  @Post(":token/issues")
  issue(
    @Param("token") token: string,
    @Body() dto: CreateReceiptIssueDto,
  ) {
    return this.receipts
      .createIssue(token, dto)
      .then((data) => ok(data, "Issue submitted"));
  }
}
