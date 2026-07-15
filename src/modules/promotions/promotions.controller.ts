import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ok } from "../../common/api-response";
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import { CreatePromotionDto, UpdatePromotionDto } from "./dto/promotion.dto";
import { PromotionsService } from "./promotions.service";

@Controller("promotions")
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
@Capabilities(BusinessCapability.CATALOG_READ)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query("productId") productId?: string) {
    return this.promotions.list(auth, productId).then((data) => ok(data));
  }

  @Post()
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  create(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: CreatePromotionDto) {
    return this.promotions.create(auth, dto).then((data) => ok(data, "Promotion created"));
  }

  @Patch(":id")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  update(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(auth, id, dto).then((data) => ok(data, "Promotion updated"));
  }

  @Delete(":id")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER")
  archive(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.promotions.archive(auth, id).then((data) => ok(data, "Promotion archived"));
  }
}
