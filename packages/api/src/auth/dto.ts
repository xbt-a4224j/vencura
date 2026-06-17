import { createZodDto } from 'nestjs-zod';
import { LoginSchema, RegisterSchema } from '@vencura/shared';

// One shared zod schema → a DTO that is both the runtime validator (via the global
// ZodValidationPipe) and the OpenAPI definition shown in Swagger / consumed by the SDK.
export class RegisterDto extends createZodDto(RegisterSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
