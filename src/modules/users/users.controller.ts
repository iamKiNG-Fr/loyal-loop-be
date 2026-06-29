import { Body, Controller, Patch, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { UpdateUserDto } from "./dto/user.dto";
import { UsersService } from "./users.service";

@Controller("users/me")
@UseGuards(OwnerAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  update(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: UpdateUserDto) {
    return this.users.update(auth, dto).then((data) => ok(data, "Profile updated"));
  }
}
