import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import {
  CUSTOMER_SESSION_COOKIE,
  readCookie,
} from "../../common/http.util";
import { ok } from "../../common/api-response";
import type {
  CustomerAuthContext,
  OwnerAuthContext,
} from "../../common/request-context";
import {
  CreateOrderRequestDto,
  ProductInterestDto,
  UpdateOrderRequestStatusDto,
  WishlistProductDto,
} from "./dto/shop.dto";
import { ShopsService } from "./shops.service";

@Controller("public/shops")
export class PublicShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get(":slug")
  getShop(@Param("slug") slug: string, @Req() request: Request) {
    return this.shops
      .getPublicShop(slug, this.visitor(request))
      .then((data) => ok(data));
  }

  @Get(":slug/products/:productSlug")
  getProduct(
    @Param("slug") slug: string,
    @Param("productSlug") productSlug: string,
    @Req() request: Request,
  ) {
    return this.shops
      .getPublicProduct(slug, productSlug, this.visitor(request))
      .then((data) => ok(data));
  }

  @Post(":slug/requests")
  createRequest(
    @Param("slug") slug: string,
    @Body() dto: CreateOrderRequestDto,
    @Req() request: Request,
  ) {
    const token = readCookie(
      request.headers.cookie,
      CUSTOMER_SESSION_COOKIE,
    );
    return this.shops
      .createRequest(slug, dto, token)
      .then((data) => ok(data, "Request submitted"));
  }

  @Get("requests/:token")
  request(@Param("token") token: string) {
    return this.shops.getRequestByToken(token).then((data) => ok(data));
  }

  private visitor(request: Request) {
    return this.shops.visitorHash(
      `${request.ip}:${request.header("user-agent") ?? ""}`,
    );
  }
}

@Controller("public/shops/:slug")
@UseGuards(CustomerAuthGuard)
export class CustomerShopController {
  constructor(private readonly shops: ShopsService) {}

  @Get("wishlist")
  wishlist(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("slug") slug: string,
  ) {
    return this.shops
      .wishlist(customer.customerAccountId, slug)
      .then((data) => ok(data));
  }

  @Post("wishlist")
  addWishlist(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("slug") slug: string,
    @Body() dto: WishlistProductDto,
  ) {
    return this.shops
      .addWishlist(customer.customerAccountId, slug, dto.productId)
      .then((data) => ok(data, "Wishlist updated"));
  }

  @Delete("wishlist/:productId")
  async removeWishlist(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("slug") slug: string,
    @Param("productId") productId: string,
  ) {
    await this.shops.removeWishlist(customer.customerAccountId, slug, productId);
    return ok(null, "Wishlist updated");
  }

  @Post("interests")
  interest(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("slug") slug: string,
    @Body() dto: ProductInterestDto,
  ) {
    return this.shops
      .interest(customer.customerAccountId, slug, dto)
      .then((data) => ok(data, "Interest recorded"));
  }
}

@Controller("order-requests")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class OrderRequestsController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.shops.listRequests(auth).then((data) => ok(data));
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER", "SALES")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateOrderRequestStatusDto,
  ) {
    return this.shops
      .updateRequest(auth, id, dto)
      .then((data) => ok(data, "Request updated"));
  }

  @Post(":id/convert")
  @Roles("OWNER", "MANAGER", "SALES")
  convert(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.shops
      .convertRequest(auth, id, idempotencyKey)
      .then((data) => ok(data, "Request converted"));
  }
}
