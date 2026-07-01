import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessesService } from "./businesses.service";
import {
  AcceptBusinessInvitationDto,
  CreateBusinessInvitationDto,
} from "./dto/business-invitation.dto";
import {
  OwnerPledgeDto,
  ReplaceBusinessContactsDto,
  UpdateBusinessDto,
  UpdateBusinessPreferencesDto,
} from "./dto/update-business.dto";

@Controller("public/trust-cards")
export class PublicTrustCardsController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get(":cardId")
  resolve(@Param("cardId") cardId: string) {
    return this.businesses
      .resolvePublicCard(cardId)
      .then((data) => ok(data));
  }
}

@Controller("businesses/current")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get()
  getCurrent(@CurrentAuth() auth: OwnerAuthContext) {
    return this.businesses.getCurrent(auth).then((data) => ok(data));
  }

  @Patch()
  @Roles("OWNER", "MANAGER")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businesses.update(auth, dto).then((data) => ok(data, "Business updated"));
  }

  @Put("contacts")
  @Roles("OWNER", "MANAGER")
  replaceContacts(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: ReplaceBusinessContactsDto,
  ) {
    return this.businesses
      .replaceContacts(auth, dto)
      .then((data) => ok(data, "Contacts updated"));
  }

  @Patch("preferences")
  @Roles("OWNER", "MANAGER")
  updatePreferences(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpdateBusinessPreferencesDto,
  ) {
    return this.businesses
      .updatePreferences(auth, dto)
      .then((data) => ok(data, "Preferences updated"));
  }

  @Post("pledge")
  @Roles("OWNER")
  pledge(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: OwnerPledgeDto,
  ) {
    return this.businesses.pledge(auth, dto).then((data) => ok(data, "Pledge saved"));
  }

  @Post("invitations")
  @Roles("OWNER", "MANAGER")
  invite(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateBusinessInvitationDto,
  ) {
    return this.businesses.invite(auth, dto).then((data) => ok(data, "Invitation created"));
  }

  @Post("invitations/accept")
  accept(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: AcceptBusinessInvitationDto,
  ) {
    return this.businesses.accept(auth, dto).then((data) => ok(data, "Invitation accepted"));
  }
}
