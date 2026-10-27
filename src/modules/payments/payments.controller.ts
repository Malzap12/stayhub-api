import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { PaymentsService } from './payments.service';
import { PaymentConfigDto, TestCardDto } from './dto/payment.dto';

@ApiTags('Pagos (Payments)')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('test-cards')
  @Public()
  @ApiOperation({
    summary: 'Tarjetas de prueba disponibles · HU-037 (CA1, CA2)',
    description: 'Tarjetas del proveedor simulado y el resultado (APROBADO / RECHAZADO) que produce cada una.',
  })
  @ApiResponse({ status: 200, type: [TestCardDto] })
  listTestCards(): TestCardDto[] {
    return this.paymentsService.listTestCards();
  }

  @Get('config')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revisar la configuración del proveedor de pagos · HU-037 (CA3, RNF-005)',
    description: 'Confirma que los pagos usan el modo de pruebas y que no hay claves de producción configuradas.',
  })
  @ApiResponse({ status: 200, type: PaymentConfigDto })
  @ApiResponse({ status: 403, description: 'Solo el administrador puede revisar la configuración' })
  getConfig(): PaymentConfigDto {
    return this.paymentsService.getConfig();
  }
}
