import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ListingsModule } from '../listings/listings.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportExportService } from './report-export.service';

/** HU-056 · Ver los indicadores del negocio. HU-058 · Exportar reportes a Excel. */
@Module({
  imports: [BookingsModule, ListingsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportService],
  exports: [ReportsService, ReportExportService],
})
export class ReportsModule {}
