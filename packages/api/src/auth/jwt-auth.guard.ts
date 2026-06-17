import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Apply with `@UseGuards(JwtAuthGuard)`; populates `req.user` from the bearer token. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
