import {Router} from "express"
import { waitlist } from "../controllers/waitlist.controller"

const router = Router()

router.post('/', waitlist)

export default router