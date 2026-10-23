import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformConfigService } from './platform-config.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PlatformController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformModule {}
