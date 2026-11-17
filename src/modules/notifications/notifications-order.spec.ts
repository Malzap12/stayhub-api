import { NotificationsService } from './notifications.service';

describe('NotificationsService · orden de "mis notificaciones"', () => {
  it('si dos notificaciones tienen la misma fecha, la última creada aparece primero', () => {
    const service = new NotificationsService();
    const first = service.notify({
      recipient: { userId: 'user-1' },
      type: 'RESERVA_CONFIRMADA',
      message: 'Reserva confirmada',
      entity: 'Booking',
      entityId: 'booking-1',
    });
    const second = service.notify({
      recipient: { userId: 'user-1' },
      type: 'RESERVA_CANCELADA',
      message: 'Reserva cancelada',
      entity: 'Booking',
      entityId: 'booking-1',
    });
    // Mismo milisegundo, como ocurre en un servidor rápido (CI).
    const sameInstant = new Date('2027-05-01T12:00:00.000Z');
    first!.createdAt = sameInstant;
    second!.createdAt = new Date(sameInstant);

    const mine = service.findMine({ userId: 'user-1' } as never);

    expect(mine.map((item) => item.type)).toEqual(['RESERVA_CANCELADA', 'RESERVA_CONFIRMADA']);
  });
});
