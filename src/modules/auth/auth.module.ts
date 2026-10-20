import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';

@Global()
@Module({
  controllers: [AuthController, PasswordRecoveryController],
  providers: [AuthService, PasswordRecoveryService],
  exports: [AuthService],
})
export class AuthModule {}
