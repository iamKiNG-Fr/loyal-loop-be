import { AddToWaitlistDTO } from "../dtos/AddToWaitList.dtos";
import { Waitlist } from "../models";
import { UniqueConstraintError } from "sequelize";

class WaitlistService {
  //Add to Waitlist
  async addToWaitlist(data: AddToWaitlistDTO) {
    try {
      return await Waitlist.create(data);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new Error("Email is already on the waitlist");
      }
      throw new Error("Failed to add to waitlist");
    }
  }
}

export default new WaitlistService();
