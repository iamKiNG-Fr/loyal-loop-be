import { z } from "zod"

export const AddToWaitlistSchema = z.object({
    name: z.string(),
    businessName: z.string(),
    email: z.string().email()
})

export type AddToWaitlistDTO = z.infer<typeof AddToWaitlistSchema>