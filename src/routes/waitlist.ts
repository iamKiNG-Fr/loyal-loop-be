import {Router} from "express"
import { waitlist } from "../controllers/waitlist"

const router = Router()

router.get('/', waitlist)

export default router