import { z } from "zod"

export const AddToWaitlistSchema = z.object({
    name: z.string().trim(),
    businessName: z.string().trim(),
    email: z.string().email().trim(),
    refCode: z.string().trim()
})

export type AddToWaitlistDTO = z.infer<typeof AddToWaitlistSchema>