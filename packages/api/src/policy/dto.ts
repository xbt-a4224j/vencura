import { createZodDto } from 'nestjs-zod';
import { PolicySchema } from '@vencura/shared';
export class PolicyDto extends createZodDto(PolicySchema) {}
