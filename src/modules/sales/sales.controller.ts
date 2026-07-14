import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import {
  CreateSaleDto,
  RecordPaymentDto,
  SaleListDto,
} from "./dto/sale.dto";
import { SalesService } from "./sales.service";

@Controller("sales")
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
@Capabilities(BusinessCapability.SALE_READ)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query() query: SaleListDto) {
    return this.sales.list(auth, query);
  }

  @Post()
  @Capabilities(BusinessCapability.SALE_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  create(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateSaleDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.sales
      .create(auth, dto, idempotencyKey?.slice(0, 120))
      .then((data) => ok(data, "Sale logged"));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.sales.get(auth, id).then((data) => ok(data));
  }

  @Post(":id/payments")
  @Capabilities(BusinessCapability.SALE_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  payment(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.sales
      .recordPayment(auth, id, dto)
      .then((data) => ok(data, "Payment updated"));
  }
}
