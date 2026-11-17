import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StatePersistenceService } from './modules/persistence/state-persistence.service';

describe('HealthController', () => {
  const build = (healthy: boolean) =>
    new HealthController({ isHealthy: async () => healthy } as unknown as StatePersistenceService);

  it('responde ok cuando la persistencia está disponible', async () => {
    await expect(build(true).check()).resolves.toEqual({ status: 'ok' });
  });

  it('responde 503 cuando PostgreSQL no responde', async () => {
    await expect(build(false).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
