import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { TrustService } from "./trust.service";

@Controller("trust")
@UseGuards(OwnerAuthGuard)
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get()
  summary(@CurrentAuth() auth: OwnerAuthContext) {
    return this.trust.summary(auth.businessId).then((data) => ok(data));
  }

  @Post("inventory-check")
  inventoryCheck(@CurrentAuth() auth: OwnerAuthContext) {
    return this.trust
      .completeInventoryCheck(auth)
      .then((data) => ok(data, "Inventory check recorded"));
  }
}
