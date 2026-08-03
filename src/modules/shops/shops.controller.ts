import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type {
  CustomerAuthContext,
  OwnerAuthContext,
} from "../../common/request-context";
import {
  CreateOrderRequestDto,
  ConfirmOrderRequestDto,
  ChangeRequestedPaymentMethodDto,
  DiscoveryAttributionDto,
  ProductInterestDto,
  RequestOrderTermsChangeDto,
  RespondOrderTermsChangeDto,
  UpdateOrderRequestStatusDto,
  WishlistProductDto,
} from "./dto/shop.dto";
import { ShopsService } from "./shops.service";

@Controller("public/shops")
export class PublicShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get(":slug")
  getShop(@Param("slug") slug: string, @Query() attribution: DiscoveryAttributionDto, @Req() request: Request) {
    return this.shops
      .getPublicShop(slug, this.visitor(request), attribution)
      .then((data) => ok(data));
  }

  @Get(":slug/products/:productSlug")
  getProduct(
    @Param("slug") slug: string,
    @Param("productSlug") productSlug: string,
    @Query() attribution: DiscoveryAttributionDto,
    @Req() request: Request,
  ) {
    return this.shops
      .getPublicProduct(slug, productSlug, this.visitor(request), attribution)
      .then((data) => ok(data));
  }

  @Post(":slug/requests")
  @UseGuards(CustomerAuthGuard)
  createRequest(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("slug") slug: string,
    @Body() dto: CreateOrderRequestDto,
  ) {
    return this.shops
      .createRequest(slug, dto, customer.customerAccountId)
      .then((data) => ok(data, "Request submitted"));
  }

  @Get("requests/:token")
  @UseGuards(CustomerAuthGuard)
  request(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
  ) {
    return this.shops.getRequestByToken(customer.customerAccountId, token).then((data) => ok(data));
  }

  @Patch("requests/:token/cancel")
  @UseGuards(CustomerAuthGuard)
  cancelRequest(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
  ) {
    return this.shops
      .cancelRequestByToken(customer.customerAccountId, token)
      .then((data) => ok(data, "Request canceled"));
  }

  @Patch("requests/:token/terms")
  @UseGuards(CustomerAuthGuard)
  respondToTermsChange(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("token") token: string,
    @Body() dto: RespondOrderTermsChangeDto,
  ) {
    return this.shops
      .respondToTermsChangeByToken(customer.customerAccountId, token, dto)
      .then((data) => ok(data, "Order choices updated"));
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

@Controller("customer-requests")
@UseGuards(CustomerAuthGuard)
export class CustomerOrderRequestsController {
  constructor(private readonly shops: ShopsService) {}

  @Patch(":id/payment-method")
  changePaymentMethod(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("id") id: string,
    @Body() dto: ChangeRequestedPaymentMethodDto,
  ) {
    return this.shops
      .changeRequestedPaymentMethod(customer.customerAccountId, id, dto.paymentMethod)
      .then((data) => ok(data, "Payment preference updated"));
  }

  @Patch(":id/terms")
  respondToTermsChange(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("id") id: string,
    @Body() dto: RespondOrderTermsChangeDto,
  ) {
    return this.shops
      .respondToTermsChange(customer.customerAccountId, id, dto)
      .then((data) => ok(data, "Order choices updated"));
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
    @Body() dto: ConfirmOrderRequestDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.shops
      .convertRequest(auth, id, dto, idempotencyKey)
      .then((data) => ok(data, "Request converted"));
  }

  @Patch(":id/read")
  @Roles("OWNER", "MANAGER", "SALES")
  markRead(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.shops
      .markRequestRead(auth, id)
      .then((data) => ok(data, "Request marked as read"));
  }

  @Post(":id/request-terms-change")
  @Roles("OWNER", "MANAGER", "SALES")
  requestTermsChange(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: RequestOrderTermsChangeDto,
  ) {
    return this.shops
      .requestTermsChange(auth, id, dto)
      .then((data) => ok(data, "Customer approval requested"));
  }
}
