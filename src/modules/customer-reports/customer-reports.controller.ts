import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ok } from "../../common/api-response";
import { CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import type { CustomerAuthContext } from "../../common/request-context";
import { CustomerReportsService } from "./customer-reports.service";
import { CreateCustomerReportDto } from "./dto/customer-report.dto";

@Controller("customer-reports")
@UseGuards(CustomerAuthGuard)
export class CustomerReportsController {
  constructor(private readonly reports: CustomerReportsService) {}

  @Post()
  create(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Body() dto: CreateCustomerReportDto,
  ) {
    return this.reports
      .create(customer.customerAccountId, dto)
      .then((data) => ok(data, "Report received"));
  }
}
