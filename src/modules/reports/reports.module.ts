import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ListingsModule } from '../listings/listings.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** HU-056 · Ver los indicadores del negocio. */
@Module({
  imports: [BookingsModule, ListingsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
