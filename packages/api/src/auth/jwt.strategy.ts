import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
}

/** Validates the bearer token's signature/expiry, then shapes `req.user`. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('JWT_SECRET is not configured');
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret });
  }

  validate(payload: JwtPayload): { id: string; email: string } {
    return { id: payload.sub, email: payload.email };
  }
}
