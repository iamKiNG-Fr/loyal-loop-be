import { Request, Response } from "express";
import {
  AddToWaitlistDTO,
  AddToWaitlistSchema,
} from "../dtos/AddToWaitList.dtos";
import waitlistService from "../services/waitlist/waitlist.service";

export const waitlist = async (
  req: Request<{}, {}, AddToWaitlistDTO>,
  res: Response
) => {
  
  try {
    const parsedBody = AddToWaitlistSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({ errors: parsedBody.error.format() });
      return;
    }
  
    const data = parsedBody.data;
    
    const waitlist = await waitlistService.addToWaitlist(data);
    res
      .status(200)
      .json({
        success: true,
        message: "Successfully joined the waitlist",
        data: waitlist,
      });
    return;
  } catch (error) {
    console.error(error);
    
    if (error instanceof Error) {
      if (error.message === "Email is already on the waitlist") {
        res
          .status(400)
          .json({ success: false, data: null, message: error.message });
        return;
      }
    }
    res
      .status(500)
      .json({ success: false, data: null, message: "Internal Server Error" });
    return;
  }
};
