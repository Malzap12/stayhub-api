import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingImagesController } from './listing-images.controller';
import { ListingImagesService } from './listing-images.service';

@Module({
  controllers: [ListingImagesController, ListingsController],
  providers: [ListingsService, ListingImagesService],
  exports: [ListingsService],
})
export class ListingsModule {}
