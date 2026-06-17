import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
}

/** Injects the authenticated user shaped by JwtStrategy.validate(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
