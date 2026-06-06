import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { generateCode } from "../../common/generate-code.util";
import { Prisma, WaitlistEntry } from "../../generated/prisma/client";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWaitlistEntryDto } from "./dto/create-waitlist-entry.dto";

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(dto: CreateWaitlistEntryDto) {
    try {
      const referrerId = await this.resolveReferrer(dto.refCode);
      const refCode = generateCode();

      const waitlistEntry = await this.prisma.waitlistEntry.create({
        data: {
          name: dto.name,
          businessName: dto.businessName,
          email: dto.email.toLowerCase(),
          refBy: referrerId,
          refCode,
        },
      });

      await this.sendWelcomeEmail(waitlistEntry);

      return waitlistEntry;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("Email is already on the waitlist");
      }

      throw error;
    }
  }

  private async resolveReferrer(refCode?: string) {
    if (!refCode) {
      return null;
    }

    const referrer = await this.prisma.waitlistEntry.findUnique({
      where: { refCode },
    });

    if (!referrer) {
      throw new BadRequestException("Invalid referral code");
    }

    return String(referrer.id);
  }

  private async sendWelcomeEmail(waitlistEntry: WaitlistEntry) {
    try {
      await this.mailService.sendWaitlistWelcomeEmail({
        to: waitlistEntry.email,
        name: waitlistEntry.name,
        businessName: waitlistEntry.businessName,
        refCode: waitlistEntry.refCode,
      });
    } catch (error) {
      this.logger.warn(
        `Waitlist entry ${waitlistEntry.id} was created, but welcome email failed.`,
      );
      this.logger.debug(error);
    }
  }
}
