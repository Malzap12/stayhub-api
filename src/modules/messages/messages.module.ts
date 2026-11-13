import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ListingsModule } from '../listings/listings.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [ListingsModule, BookingsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
