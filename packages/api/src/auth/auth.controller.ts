import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Accounts for the User-view picker (id + email only). The web has no typed login: it lists
  // accounts here and signs in with the shared demo password. register/login are the real path.
  @Get('accounts')
  listAccounts() {
    return this.auth.listAccounts();
  }

  // The single self-registered user (or null) — the User view shows register if null, else login.
  @Get('user')
  singleUser() {
    return this.auth.singleUser();
  }

  // Who the bearer token belongs to — lets the web restore a session from the persisted token on
  // reload (any account, demo or real), instead of re-logging-in. 401s if the token is missing/expired.
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { id: string; email: string }) {
    return { id: user.id, email: user.email };
  }
}
