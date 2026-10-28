import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ListingsModule } from '../listings/listings.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [ListingsModule, BookingsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
