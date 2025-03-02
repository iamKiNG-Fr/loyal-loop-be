import { AddToWaitlistDTO } from "../../dtos/AddToWaitList.dtos";
import { Waitlist } from "../../models";
import { UniqueConstraintError } from "sequelize";
import { EmailService } from "../../utils/email.utils";
import { generateCode } from "../../utils/generateCode.utils";

class WaitlistService {
  //Add to Waitlist
  async addToWaitlist(data: AddToWaitlistDTO) {
    try {

      const refCode = generateCode(6);

      let referrerId = null;

      if (data.refCode) {
        const referrer = await Waitlist.findOne({
          where: { refCode : data.refCode },
        });

        if (!referrer) {
          throw new Error("Invalid referral code");
        }

        referrerId = referrer.id;
      }

      const waitlistEntry = await Waitlist.create({
        name: data.name,
        businessName: data.businessName,
        email: data.email,
        refBy: referrerId,
        refCode,
      });

      await EmailService.sendEmail(
        data.email,
        data.name,
        data.businessName,
        refCode
      );

      return waitlistEntry;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new Error("Email is already on the waitlist");
      }
      console.log(error);
      throw new Error("Failed to add to waitlist");
      
    }
  }

  // Get the top referrers
  // async getTopReferrers(limit = 10) {
  //   return await Waitlist.findAll({
  //     attributes: ["referredBy", [Sequelize.fn("COUNT", Sequelize.col("referredBy")), "referrals"]],
  //     where: { referredBy: { [Sequelize.Op.not]: null } },
  //     group: ["referredBy"],
  //     order: [[Sequelize.literal("referrals"), "DESC"]],
  //     limit,
  //   });
}

export default new WaitlistService();
