import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
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

  // Mint a session for the system admin/operator account — no password. Gated by the admin key
  // (the admin is a system identity, not a person); the Admin view calls this to act as the admin.
  @Post('admin-session')
  @HttpCode(200)
  @ApiHeader({ name: 'x-admin-key', description: 'Admin API key', required: true })
  @UseGuards(AdminGuard)
  adminSession() {
    return this.auth.adminSession();
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
