import { createZodDto } from 'nestjs-zod';
import { SignMessageSchema } from '@vencura/shared';

export class SignMessageDto extends createZodDto(SignMessageSchema) {}
