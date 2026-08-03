import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ok } from "../../common/api-response";
import { AdminOriginGuard } from "../../common/auth/admin-origin.guard";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { PlatformRoles } from "../../common/auth/platform-roles.decorator";
import { PlatformRolesGuard } from "../../common/auth/platform-roles.guard";
import { CurrentPlatformAdmin } from "../../common/auth/current-auth.decorator";
import type { PlatformAuthContext } from "../../common/request-context";
import {
  CreateFoundingCohortDto,
  CreateFoundingInvitationDto,
  CreateResearchInterviewDto,
  CompleteLegacyFoundingApplicationDto,
  ReviewFoundingApplicationDto,
  RevokeInvitationDto,
} from "../founding-circle/dto/founding-circle.dto";
import {
  ApproveFoundingApplicationDto,
  AdminListQueryDto,
  GrantPlatformAdminDto,
  ReactivateBusinessDto,
  ReplaceInvitationDto,
  ReviewPlatformAdminDto,
  ReviewCustomerReportDto,
  RevokePlatformSessionDto,
  SuspendBusinessDto,
  UpdatePlatformAdminDto,
} from "./dto/platform-admin.dto";
import { PlatformAdminService } from "./platform-admin.service";

@Controller("admin")
@UseGuards(AdminOriginGuard, PlatformAdminGuard, PlatformRolesGuard)
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get("overview")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async overview(@Query("includeDemo") includeDemo?: string) {
    return ok(await this.admin.overview(includeDemo === "true"));
  }

  @Get("businesses")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async businesses(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.businesses(query));
  }

  @Get("customer-reports")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async customerReports(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.customerReports(query));
  }

  @Patch("customer-reports/:id")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async reviewCustomerReport(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: ReviewCustomerReportDto,
  ) {
    return ok(
      await this.admin.reviewCustomerReport(auth, id, dto),
      "Report review updated",
    );
  }

  @Get("businesses/:id")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async business(@Param("id") id: string) {
    return ok(await this.admin.business(id));
  }

  @Post("businesses/:id/suspend")
  @PlatformRoles("SUPERADMIN")
  async suspend(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: SuspendBusinessDto,
  ) {
    return ok(await this.admin.suspendBusiness(auth, id, dto), "Business suspended");
  }

  @Post("businesses/:id/reactivate")
  @PlatformRoles("SUPERADMIN")
  async reactivate(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: ReactivateBusinessDto,
  ) {
    return ok(await this.admin.reactivateBusiness(auth, id, dto), "Business reactivated");
  }

  @Get("founding-circle/applications")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async applications(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.applications(query));
  }

  @Post("founding-circle/applications/:id/approve")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async approve(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() body: ApproveFoundingApplicationDto,
  ) {
    return ok(await this.admin.approveApplication(auth, id, body), "Application approved and invitation created");
  }

  @Post("founding-circle/applications/:id/decline")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async decline(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: ReviewFoundingApplicationDto,
  ) {
    return ok(await this.admin.declineApplication(auth, id, dto.notes), "Application declined");
  }

  @Patch("founding-circle/applications/:id")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async completeLegacyApplication(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: CompleteLegacyFoundingApplicationDto,
  ) {
    return ok(
      await this.admin.completeLegacyApplication(auth, id, dto),
      "Application contact completed",
    );
  }

  @Get("founding-circle/invitations")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async invitations(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.invitations(query));
  }

  @Post("founding-circle/invitations")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async createInvitation(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Body() dto: CreateFoundingInvitationDto,
  ) {
    return ok(await this.admin.createInvitation(auth, dto), "Invitation created");
  }

  @Post("founding-circle/invitations/:id/revoke")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async revoke(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: RevokeInvitationDto,
  ) {
    return ok(await this.admin.revokeInvitation(auth, id, dto.reason), "Invitation revoked");
  }

  @Post("founding-circle/invitations/:id/replace")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async replace(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() body: ReplaceInvitationDto,
  ) {
    return ok(await this.admin.replaceInvitation(auth, id, body.sendWhatsapp ?? true), "Replacement invitation created");
  }

  @Get("founding-circle/cohorts")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async cohorts() {
    return ok(await this.admin.cohorts());
  }

  @Post("founding-circle/cohorts")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async createCohort(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Body() dto: CreateFoundingCohortDto,
  ) {
    return ok(await this.admin.createCohort(auth, dto), "Cohort created");
  }

  @Post("founding-circle/cohorts/:id/archive")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async archiveCohort(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
  ) {
    return ok(await this.admin.archiveCohort(auth, id), "Cohort archived");
  }

  @Get("founding-circle/members")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async members(@Query("includeDemo") includeDemo?: string) {
    return ok(await this.admin.members(includeDemo === "true"));
  }

  @Post("founding-circle/members/:enrollmentId/interviews")
  @PlatformRoles("SUPERADMIN", "ADMIN")
  async interview(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("enrollmentId") enrollmentId: string,
    @Body() dto: CreateResearchInterviewDto,
  ) {
    return ok(await this.admin.createInterview(auth, enrollmentId, dto), "Interview recorded");
  }

  @Get("audit-logs")
  @PlatformRoles("SUPERADMIN")
  async audit(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.auditLogs(query));
  }

  @Get("access/admins")
  @PlatformRoles("SUPERADMIN")
  async platformAdmins(@Query() query: AdminListQueryDto) {
    return ok(await this.admin.platformAdmins(query));
  }

  @Post("access/admins")
  @PlatformRoles("SUPERADMIN")
  async grantPlatformAdmin(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Body() dto: GrantPlatformAdminDto,
  ) {
    return ok(await this.admin.grantPlatformAdmin(auth, dto), "Platform access granted");
  }

  @Patch("access/admins/:id")
  @PlatformRoles("SUPERADMIN")
  async updatePlatformAdmin(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdatePlatformAdminDto,
  ) {
    return ok(await this.admin.updatePlatformAdmin(auth, id, dto), "Platform access updated");
  }

  @Post("access/admins/:id/review")
  @PlatformRoles("SUPERADMIN")
  async reviewPlatformAdmin(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: ReviewPlatformAdminDto,
  ) {
    return ok(await this.admin.reviewPlatformAdmin(auth, id, dto), "Access review recorded");
  }

  @Get("access/admins/:id/sessions")
  @PlatformRoles("SUPERADMIN")
  async platformAdminSessions(@Param("id") id: string) {
    return ok(await this.admin.platformAdminSessions(id));
  }

  @Post("access/admins/:id/sessions/:sessionId/revoke")
  @PlatformRoles("SUPERADMIN")
  async revokePlatformAdminSession(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: RevokePlatformSessionDto,
  ) {
    return ok(
      await this.admin.revokePlatformAdminSession(auth, id, sessionId, dto),
      "Platform session revoked",
    );
  }
}
