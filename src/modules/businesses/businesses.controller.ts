import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import { BusinessesService } from "./businesses.service";
import {
  AcceptBusinessInvitationDto,
  CreateBusinessInvitationDto,
} from "./dto/business-invitation.dto";
import {
  OpenShopDto,
  ScheduleShopLaunchDto,
} from "./dto/shop-launch.dto";
import {
  OwnerPledgeDto,
  ReplaceBusinessContactsDto,
  StartBusinessWhatsappVerificationDto,
  UpdateBusinessDto,
  UpdateBusinessPreferencesDto,
  VerifyBusinessWhatsappVerificationDto,
} from "./dto/update-business.dto";
import { UpdateMemberPermissionsDto } from "./dto/member-permission.dto";

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
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get()
  getCurrent(@CurrentAuth() auth: OwnerAuthContext) {
    return this.businesses.getCurrent(auth).then((data) => ok(data));
  }

  @Patch()
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER", "MANAGER")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businesses.update(auth, dto).then((data) => ok(data, "Business updated"));
  }

  @Put("contacts")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER", "MANAGER")
  replaceContacts(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: ReplaceBusinessContactsDto,
  ) {
    return this.businesses
      .replaceContacts(auth, dto)
      .then((data) => ok(data, "Contacts updated"));
  }

  @Post("contacts/whatsapp/start")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER")
  @Throttle({ default: { limit: 3, ttl: minutes(10) } })
  startWhatsappChange(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: StartBusinessWhatsappVerificationDto,
  ) {
    return this.businesses
      .startWhatsappChange(auth, dto.phone)
      .then((data) => ok(data, "WhatsApp verification sent"));
  }

  @Post("contacts/whatsapp/verify")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  verifyWhatsappChange(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: VerifyBusinessWhatsappVerificationDto,
  ) {
    return this.businesses
      .verifyWhatsappChange(auth, dto.challengeId, dto.code)
      .then((data) => ok(data, "Replacement WhatsApp number verified"));
  }

  @Patch("preferences")
  @Capabilities(BusinessCapability.SETTINGS_WRITE)
  @Roles("OWNER", "MANAGER")
  updatePreferences(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpdateBusinessPreferencesDto,
  ) {
    return this.businesses
      .updatePreferences(auth, dto)
      .then((data) => ok(data, "Preferences updated"));
  }

  @Put("launch")
  @Roles("OWNER", "MANAGER")
  scheduleLaunch(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: ScheduleShopLaunchDto,
  ) {
    return this.businesses
      .scheduleLaunch(auth, dto)
      .then((data) => ok(data, "Shop launch scheduled"));
  }

  @Delete("launch")
  @Roles("OWNER", "MANAGER")
  cancelLaunch(@CurrentAuth() auth: OwnerAuthContext) {
    return this.businesses
      .cancelLaunch(auth)
      .then((data) => ok(data, "Shop launch canceled"));
  }

  @Post("open")
  @Roles("OWNER", "MANAGER")
  openShop(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: OpenShopDto,
  ) {
    return this.businesses
      .openShop(auth, dto)
      .then((data) => ok(data, "Shop opened"));
  }

  @Post("pause")
  @Roles("OWNER", "MANAGER")
  pauseShop(@CurrentAuth() auth: OwnerAuthContext) {
    return this.businesses
      .pauseShop(auth)
      .then((data) => ok(data, "Shop paused"));
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

  @Patch("members/:id/permissions")
  @Capabilities(BusinessCapability.PERMISSION_ADMIN)
  @Roles("OWNER")
  updateMemberPermissions(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateMemberPermissionsDto,
  ) {
    return this.businesses
      .updateMemberPermissions(auth, id, dto)
      .then((data) => ok(data, "Member permissions updated"));
  }

  @Post("invitations/accept")
  accept(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: AcceptBusinessInvitationDto,
  ) {
    return this.businesses.accept(auth, dto).then((data) => ok(data, "Invitation accepted"));
  }
}
