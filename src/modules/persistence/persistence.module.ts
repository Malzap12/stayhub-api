import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { StatePersistenceService } from './state-persistence.service';
import { PersistStateInterceptor } from './persist-state.interceptor';

@Global()
@Module({
  providers: [StatePersistenceService, { provide: APP_INTERCEPTOR, useClass: PersistStateInterceptor }],
  exports: [StatePersistenceService],
})
export class PersistenceModule {}
