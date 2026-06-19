import { createZodDto } from 'nestjs-zod';
import { TransferSchema } from '@vencura/shared';

export class TransferDto extends createZodDto(TransferSchema) {}
