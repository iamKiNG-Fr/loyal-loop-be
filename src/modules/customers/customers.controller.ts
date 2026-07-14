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
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import { CustomersService } from "./customers.service";
import {
  AddCustomerNoteDto,
  AssignCustomerTagsDto,
  CreateCustomerDto,
  CreateCustomerTagDto,
  CustomerListDto,
  UpdateCustomerDto,
} from "./dto/customer.dto";

@Controller("customers")
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
@Capabilities(BusinessCapability.CUSTOMER_READ)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query() query: CustomerListDto) {
    return this.customers.list(auth, query);
  }

  @Post()
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  create(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: CreateCustomerDto) {
    return this.customers
      .create(auth, dto)
      .then((data) => ok(data, "Customer added"));
  }

  @Get("tags")
  tags(@CurrentAuth() auth: OwnerAuthContext) {
    return this.customers.listTags(auth).then((data) => ok(data));
  }

  @Post("tags")
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  createTag(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateCustomerTagDto,
  ) {
    return this.customers
      .createTag(auth, dto)
      .then((data) => ok(data, "Tag created"));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.customers.get(auth, id).then((data) => ok(data));
  }

  @Patch(":id")
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers
      .update(auth, id, dto)
      .then((data) => ok(data, "Customer updated"));
  }

  @Post(":id/notes")
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  note(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: AddCustomerNoteDto,
  ) {
    return this.customers
      .addNote(auth, id, dto)
      .then((data) => ok(data, "Note added"));
  }

  @Put(":id/tags")
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  assignTags(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: AssignCustomerTagsDto,
  ) {
    return this.customers
      .assignTags(auth, id, dto)
      .then((data) => ok(data, "Tags updated"));
  }

  @Get(":id/timeline")
  timeline(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.customers.timeline(auth, id).then((data) => ok(data));
  }

  @Get(":id/insight-summary")
  insight(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.customers.insight(auth, id).then((data) => ok(data));
  }

  @Post(":id/insight-summary/refresh")
  @Capabilities(BusinessCapability.INSIGHT_READ)
  @Roles("OWNER", "MANAGER", "SALES")
  refreshInsight(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
  ) {
    return this.customers
      .refreshInsight(auth, id)
      .then((data) => ok(data, "Customer summary refreshed"));
  }

  @Delete(":id")
  @Capabilities(BusinessCapability.CUSTOMER_WRITE)
  @Roles("OWNER", "MANAGER")
  remove(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.customers
      .remove(auth, id)
      .then((data) => ok(data, "Customer deleted"));
  }
}
