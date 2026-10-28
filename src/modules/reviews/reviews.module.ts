import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ListingsModule } from '../listings/listings.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/** HU-047 · Calificar y reseñar mi estancia. */
@Module({
  imports: [BookingsModule, ListingsModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
