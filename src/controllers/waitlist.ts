import { Request, Response } from "express";
import {
  AddToWaitlistDTO,
  AddToWaitlistSchema,
} from "../dtos/AddToWaitList.dtos";
import waitlistService from "../services/waitlistService";

export const waitlist = async(
  req: Request<{}, {}, AddToWaitlistDTO>,
  res: Response
) => {
  const parsedBody = AddToWaitlistSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({ errors: parsedBody.error.format() });
  }

  const data = parsedBody.data;

  try {
    const waitlist = await waitlistService.addToWaitlist(data);
    return res.status(200).json(waitlist);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add to waitlist" });
  }
}
