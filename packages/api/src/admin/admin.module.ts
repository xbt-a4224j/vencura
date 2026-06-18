import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

// PrismaModule is @Global, so PrismaService injects without importing it here.
@Module({
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
