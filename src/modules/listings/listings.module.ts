import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingImagesController } from './listing-images.controller';
import { ListingImagesService } from './listing-images.service';
import { GeocodingService } from './geocoding.service';
import { GeocodingInterceptor } from './geocoding.interceptor';

@Module({
  controllers: [ListingImagesController, ListingsController],
  providers: [ListingsService, ListingImagesService, GeocodingService, GeocodingInterceptor],
  exports: [ListingsService, GeocodingService],
})
export class ListingsModule {}
