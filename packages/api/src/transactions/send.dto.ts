import { createZodDto } from 'nestjs-zod';
import { SendTransactionSchema } from '@vencura/shared';

export class SendTransactionDto extends createZodDto(SendTransactionSchema) {}
