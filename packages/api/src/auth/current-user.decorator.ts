import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Injects the authenticated user shaped by JwtStrategy.validate(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string; email: string } => ctx.switchToHttp().getRequest().user,
);
