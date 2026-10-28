import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { ActiveSession } from '../auth/auth.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Calificar y reseñar mi estancia · HU-047 (CA1, CA2, CA3, CA4)',
    description:
      'El huésped califica de 1 a 5 y comenta una reserva propia COMPLETADA (RF-063). La reseña se publica asociada al huésped, a la reserva, al alojamiento y a la fecha, y actualiza la calificación promedio del alojamiento (RF-064). Una sola reseña por reserva (RN-024), hasta 30 días después de la salida (AMB-21).',
  })
  @ApiResponse({ status: 201, description: 'Reseña publicada', type: ReviewResponseDto })
  @ApiResponse({
    status: 400,
    description: 'La reserva no está COMPLETADA (RESERVA_NO_COMPLETADA), el plazo venció (PLAZO_RESENA_VENCIDO) o los datos no son válidos',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'La reserva es de otro huésped (RESERVA_AJENA)' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  @ApiResponse({ status: 409, description: 'La reserva ya tiene reseña (RESENA_DUPLICADA)' })
  create(@Body() dto: CreateReviewDto, @CurrentUser() user?: ActiveSession): ReviewResponseDto {
    return this.reviewsService.create(dto, user?.email);
  }
}
