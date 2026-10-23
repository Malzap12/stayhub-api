import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsModule } from '../listings/listings.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [ListingsModule, PlatformModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
