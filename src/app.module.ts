import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ListingsModule } from './modules/listings/listings.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { MailModule } from './modules/mail/mail.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PersistenceModule } from './modules/persistence/persistence.module';
import { RolesGuard } from './common/guards/roles.guard';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { StructuredLoggingInterceptor } from './common/interceptors/structured-logging.interceptor';
import { GlobalExceptionsFilter } from './common/filters/global-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    ReportsModule,
    AuditModule,
    MailModule,
    PlatformModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: StructuredLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
