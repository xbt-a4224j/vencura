import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

// PrismaModule is @Global, so PrismaService injects without importing it here.
@Module({
  controllers: [AdminController],
})
export class AdminModule {}
