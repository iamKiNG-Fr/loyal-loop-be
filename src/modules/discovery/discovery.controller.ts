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
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  CurrentAuth,
  CurrentCustomer,
} from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type {
  CustomerAuthContext,
  OwnerAuthContext,
} from "../../common/request-context";
import { DiscoveryService } from "./discovery.service";
import {
  CreateShowcaseDto,
  DiscoveryEventDto,
  DiscoveryPreferenceDto,
  ExploreDto,
  ParseDiscoveryQueryDto,
  UpdateShowcaseDto,
} from "./dto/discovery.dto";

@Controller("public/discovery")
export class PublicDiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  explore(@Query() query: ExploreDto, @Req() request: Request) {
    return this.discovery.explore(query, undefined, this.discovery.visitorHash(request)).then((data) => ok(data));
  }

  @Post("parse-query")
  parseQuery(@Body() dto: ParseDiscoveryQueryDto) {
    return this.discovery.parseQuery(dto.query).then((data) => ok(data));
  }

  @Post("events")
  event(@Body() dto: DiscoveryEventDto, @Req() request: Request) {
    return this.discovery
      .recordEvent(dto, undefined, this.discovery.visitorHash(request))
      .then((data) => ok(data));
  }

  @Put("preferences")
  preference(@Body() dto: DiscoveryPreferenceDto, @Req() request: Request) {
    return this.discovery
      .savePreference(dto.preferences, undefined, this.discovery.visitorHash(request))
      .then((data) => ok(data, "Preferences saved"));
  }

  @Delete("privacy")
  clearPrivacy(@Req() request: Request) {
    return this.discovery
      .clearRecommendationData(undefined, this.discovery.visitorHash(request))
      .then((data) => ok(data, "Anonymous recommendation data cleared"));
  }

  @Get("showcases/:id")
  showcase(@Param("id") id: string) {
    return this.discovery.publicShowcase(id).then((data) => ok(data));
  }
}

@Controller("customer-discovery")
@UseGuards(CustomerAuthGuard)
export class CustomerDiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get("shops")
  shops(@CurrentCustomer() customer: CustomerAuthContext) {
    return this.discovery
      .myShops(customer.customerAccountId)
      .then((data) => ok(data));
  }

  @Get("feed")
  feed(@CurrentCustomer() customer: CustomerAuthContext, @Query() query: ExploreDto) {
    return this.discovery.explore(query, customer.customerAccountId).then((data) => ok(data));
  }

  @Put("preferences")
  preference(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Body() dto: DiscoveryPreferenceDto,
  ) {
    return this.discovery
      .savePreference(dto.preferences, customer.customerAccountId)
      .then((data) => ok(data, "Preferences saved"));
  }

  @Post("events")
  event(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Body() dto: DiscoveryEventDto,
  ) {
    return this.discovery
      .recordEvent(dto, customer.customerAccountId)
      .then((data) => ok(data));
  }

  @Delete("privacy")
  clearPrivacy(@CurrentCustomer() customer: CustomerAuthContext) {
    return this.discovery
      .clearRecommendationData(customer.customerAccountId)
      .then((data) => ok(data, "Recommendation data disconnected from your account"));
  }

  @Get("saved")
  saved(@CurrentCustomer() customer: CustomerAuthContext) {
    return this.discovery
      .saved(customer.customerAccountId)
      .then((data) => ok(data));
  }

  @Get("shops/:businessId/following")
  following(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("businessId") businessId: string,
  ) {
    return this.discovery
      .following(customer.customerAccountId, businessId)
      .then((data) => ok(data));
  }

  @Post("shops/:businessId/follow")
  follow(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("businessId") businessId: string,
  ) {
    return this.discovery
      .follow(customer.customerAccountId, businessId)
      .then((data) => ok(data, "Shop added to My Shops"));
  }

  @Delete("shops/:businessId/follow")
  async unfollow(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("businessId") businessId: string,
  ) {
    await this.discovery.unfollow(customer.customerAccountId, businessId);
    return ok(null, "Shop removed from My Shops");
  }

  @Post("showcases/:showcaseId/save")
  saveShowcase(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("showcaseId") showcaseId: string,
  ) {
    return this.discovery
      .saveShowcase(customer.customerAccountId, showcaseId)
      .then((data) => ok(data, "Showcase saved"));
  }

  @Delete("showcases/:showcaseId/save")
  async removeShowcase(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("showcaseId") showcaseId: string,
  ) {
    await this.discovery.removeShowcase(customer.customerAccountId, showcaseId);
    return ok(null, "Showcase removed from Saved");
  }
}

@Controller("showcases")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class ShowcasesController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.discovery.ownerShowcases(auth).then((data) => ok(data));
  }

  @Post()
  @Roles("OWNER", "MANAGER", "SALES")
  create(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateShowcaseDto,
  ) {
    return this.discovery
      .createShowcase(auth, dto)
      .then((data) => ok(data, "Showcase created"));
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER", "SALES")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateShowcaseDto,
  ) {
    return this.discovery
      .updateShowcase(auth, id, dto)
      .then((data) => ok(data, "Showcase updated"));
  }

  @Delete(":id")
  @Roles("OWNER", "MANAGER")
  archive(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.discovery
      .archiveShowcase(auth, id)
      .then((data) => ok(data, "Showcase archived"));
  }
}
