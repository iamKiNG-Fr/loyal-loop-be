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
@UseGuards(OwnerAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query() query: CustomerListDto) {
    return this.customers.list(auth, query);
  }

  @Post()
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

  @Delete(":id")
  @Roles("OWNER", "MANAGER")
  remove(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.customers
      .remove(auth, id)
      .then((data) => ok(data, "Customer deleted"));
  }
}
