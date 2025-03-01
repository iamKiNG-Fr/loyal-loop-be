import { AddToWaitlistDTO } from "../../dtos/AddToWaitList.dtos";
import { Waitlist } from "../../models";
import { UniqueConstraintError } from "sequelize";
import { EmailService } from "./email.service";

class WaitlistService {
  //Add to Waitlist
  async addToWaitlist(data: AddToWaitlistDTO) {
    try {
      const waitlistEntry = await Waitlist.create(data);
      await EmailService.sendEmail(data.email, data.name, data.businessName, undefined)
      return waitlistEntry
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new Error("Email is already on the waitlist");
      }
      throw new Error("Failed to add to waitlist");
    }
  }
}

export default new WaitlistService();
