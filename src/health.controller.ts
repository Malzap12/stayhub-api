import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/decorators/roles.decorator';
import { StatePersistenceService } from './modules/persistence/state-persistence.service';

@ApiTags('Salud')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly persistence: StatePersistenceService) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la API y de la conexión con PostgreSQL (para healthchecks)' })
  async check(): Promise<{ status: 'ok' }> {
    if (!(await this.persistence.isHealthy())) {
      throw new ServiceUnavailableException('Base de datos no disponible');
    }
    return { status: 'ok' };
  }
}
