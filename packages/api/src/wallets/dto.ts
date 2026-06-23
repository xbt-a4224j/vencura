import { createZodDto } from 'nestjs-zod';
import { CreateWalletSchema } from '@vencura/shared';

export class CreateWalletDto extends createZodDto(CreateWalletSchema) {}
