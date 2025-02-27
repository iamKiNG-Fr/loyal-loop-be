import { AddToWaitlistDTO } from "../dtos/AddToWaitList.dtos";
import { Waitlist } from "../models";

class WaitlistService {
  //Add to Waitlist
  async addToWaitlist(data: AddToWaitlistDTO) {
    return await Waitlist.create(data);
  }
}

export default new WaitlistService();
