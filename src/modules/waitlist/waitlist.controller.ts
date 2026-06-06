import { Body, Controller, Post } from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import { ApiResponse } from "../../common/api-response";
import { WaitlistEntry } from "../../generated/prisma/client";
import { CreateWaitlistEntryDto } from "./dto/create-waitlist-entry.dto";
import { WaitlistService } from "./waitlist.service";

@Controller("waitlist")
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: minutes(1) } })
  async create(
    @Body() dto: CreateWaitlistEntryDto,
  ): Promise<ApiResponse<WaitlistEntry>> {
    const waitlistEntry = await this.waitlistService.create(dto);

    return {
      success: true,
      message: "Successfully joined the waitlist",
      data: waitlistEntry,
    };
  }
}
