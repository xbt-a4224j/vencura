import { createZodDto } from 'nestjs-zod';
import { ContractReadSchema, ContractWriteSchema } from '@vencura/shared';

export class ContractReadDto extends createZodDto(ContractReadSchema) {}
export class ContractWriteDto extends createZodDto(ContractWriteSchema) {}
