import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { AuthService, type ActiveSession } from '../auth/auth.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rowsToSource, sourceToRows, TABLE_DEFINITIONS } from '../persistence/state-tables';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

describe('HU-070 · Conversar por mensajes entre huésped y anfitrión (EP-18)', () => {
  let auditService: AuditService;
  let notificationsService: NotificationsService;
  let authService: AuthService;
  let listingsService: ListingsService;
  let bookingsService: BookingsService;
  let messagesService: MessagesService;
  let controller: MessagesController;

  let hostSession: ActiveSession;
  let host2Session: ActiveSession;
  let guestSession: ActiveSession;
  let guest2Session: ActiveSession;
  let adminSession: ActiveSession;
  let activeListingId: string;
  let draftListingId: string;

  beforeEach(async () => {
    auditService = new AuditService();
    notificationsService = new NotificationsService();
    authService = new AuthService(auditService, undefined, undefined, notificationsService);
    authService.onModuleInit();

    listingsService = new ListingsService(auditService, authService);
    listingsService.onModuleInit();

    bookingsService = new BookingsService(
      auditService,
      listingsService,
      undefined,
      undefined,
      undefined,
      notificationsService,
      authService,
    );

    messagesService = new MessagesService(
      listingsService,
      bookingsService,
      authService,
      notificationsService,
      undefined,
      auditService,
    );
    messagesService.onModuleInit();
    controller = new MessagesController(messagesService);

    await authService.register({
      name: 'Carlos Anfitrión',
      email: 'carlos.host@stayhub.com',
      password: 'Password123',
      role: Role.ANFITRION,
      phone: '+57 300 111 2233',
    });
    const hostLogin = await authService.login({ email: 'carlos.host@stayhub.com', password: 'Password123' });
    hostSession = authService.getSession(hostLogin.token)!;

    await authService.register({
      name: 'Otro Anfitrión',
      email: 'otro.host@stayhub.com',
      password: 'Password123',
      role: Role.ANFITRION,
    });
    const host2Login = await authService.login({ email: 'otro.host@stayhub.com', password: 'Password123' });
    host2Session = authService.getSession(host2Login.token)!;

    await authService.register({
      name: 'Laura Huésped',
      email: 'laura.guest@stayhub.com',
      password: 'Password123',
      role: Role.HUESPED,
      phone: '+57 310 555 8899',
    });
    const guestLogin = await authService.login({ email: 'laura.guest@stayhub.com', password: 'Password123' });
    guestSession = authService.getSession(guestLogin.token)!;

    await authService.register({
      name: 'Pedro Intruso',
      email: 'pedro.other@stayhub.com',
      password: 'Password123',
      role: Role.HUESPED,
    });
    const guest2Login = await authService.login({ email: 'pedro.other@stayhub.com', password: 'Password123' });
    guest2Session = authService.getSession(guest2Login.token)!;

    const adminAccount = authService.seedInitialAdmin();
    adminSession = {
      token: 'admin-token',
      userId: adminAccount.id,
      email: adminAccount.email,
      role: Role.ADMINISTRADOR,
      expiresAt: Date.now() + 60_000,
    };

    const created = listingsService.create(
      {
        title: 'Loft con vista en El Poblado',
        city: 'Medellín',
        department: 'Antioquia',
        address: 'Calle 10 # 35-20',
        pricePerNight: 280000,
        maxGuests: 2,
      },
      hostSession,
    );
    (listingsService.getListing(created.id) as any).status = ListingStatus.ACTIVA;
    activeListingId = created.id;

    const draft = listingsService.create(
      {
        title: 'Cabaña en borrador',
        city: 'Guatapé',
        department: 'Antioquia',
        address: 'Vereda El Roble',
        pricePerNight: 200000,
        maxGuests: 4,
      },
      hostSession,
    );
    draftListingId = draft.id;
  });

  it('CA1: huésped en alojamiento ACTIVO crea una única conversación por (huésped, publicación) y la reutiliza', () => {
    const first = controller.startOrSend(
      { listingId: activeListingId, content: 'Hola, ¿tienen parqueadero?' },
      guestSession,
    );

    expect(first.conversation.listingId).toBe(activeListingId);
    expect(first.conversation.counterpartName).toBe('Carlos Anfitrión');
    expect(first.messages.data).toHaveLength(1);
    expect(first.messages.data[0].content).toBe('Hola, ¿tienen parqueadero?');

    const second = controller.startOrSend(
      { listingId: activeListingId, content: 'También quería saber la hora de llegada.' },
      guestSession,
    );

    expect(second.conversation.id).toBe(first.conversation.id);
    expect(second.messages.total).toBe(2);
    expect(controller.lookup(guestSession, activeListingId)).toEqual({ conversationId: first.conversation.id });
  });

  it('CA1: rechaza iniciar conversación nueva si el alojamiento no está ACTIVO', () => {
    expect(() =>
      controller.startOrSend({ listingId: draftListingId, content: 'Hola' }, guestSession),
    ).toThrow(BadRequestException);
  });

  it('CA2: anfitrión puede responder o escribir desde el detalle de una reserva a la misma conversación', () => {
    const bookingList = (bookingsService as any).bookingsStore as any[];
    bookingList.push({
      id: 'booking-hu070-1',
      listingId: activeListingId,
      guestId: guestSession.email,
      checkIn: '2027-02-10',
      checkOut: '2027-02-12',
      guests: 2,
      totalAmount: 560000,
      currency: 'COP',
      status: 'CONFIRMADA',
      createdAt: new Date(),
    });

    const fromBooking = controller.startOrSend(
      { bookingId: 'booking-hu070-1', content: '¡Hola Laura! Te envío las indicaciones de llegada.' },
      hostSession,
    );

    expect(fromBooking.conversation.guestName).toBe('Laura Huésped');
    expect(fromBooking.conversation.counterpartName).toBe('Laura Huésped');
    expect(fromBooking.messages.data[0].senderRole).toBe('ANFITRION');

    const guestReply = controller.startOrSend(
      { listingId: activeListingId, content: 'Muchas gracias, llegamos a las 3 pm.' },
      guestSession,
    );
    expect(guestReply.conversation.id).toBe(fromBooking.conversation.id);
    expect(guestReply.messages.total).toBe(2);
    expect(controller.lookup(hostSession, undefined, 'booking-hu070-1')).toEqual({
      conversationId: fromBooking.conversation.id,
    });
  });

  it('CA2: anfitrión no puede escribir a un huésped que no le ha escrito ni ha reservado con él', () => {
    expect(() =>
      controller.startOrSend(
        { listingId: activeListingId, guestId: guest2Session.userId, content: 'Oferta externa' },
        hostSession,
      ),
    ).toThrow(ForbiddenException);
  });

  it('CA3 & CA4: bandeja y mensajes paginados con lo más reciente primero; abrir marca como leídos y baja contador', async () => {
    const created2 = listingsService.create(
      {
        title: 'Apartamento Laureles',
        city: 'Medellín',
        department: 'Antioquia',
        address: 'Circular 4 # 70-10',
        pricePerNight: 210000,
        maxGuests: 3,
      },
      hostSession,
    );
    (listingsService.getListing(created2.id) as any).status = ListingStatus.ACTIVA;

    const conv1 = controller.startOrSend({ listingId: activeListingId, content: 'Mensaje en pub 1' }, guestSession);
    await new Promise((res) => setTimeout(res, 15));
    const conv2 = controller.startOrSend({ listingId: created2.id, content: 'Mensaje en pub 2' }, guestSession);
    await new Promise((res) => setTimeout(res, 15));
    controller.sendMessage(conv1.conversation.id, { content: 'Segundo mensaje en pub 1' }, guestSession);

    const inboxPage1 = controller.listMine(hostSession, '1', '1');
    expect(inboxPage1.total).toBe(2);
    expect(inboxPage1.totalPages).toBe(2);
    expect(inboxPage1.unreadConversations).toBe(2);
    // Lo más reciente primero: conv1 recibió su segundo mensaje después de conv2
    expect(inboxPage1.data[0].id).toBe(conv1.conversation.id);
    expect(controller.getUnreadCount(hostSession)).toEqual({ unreadConversations: 2, unreadMessages: 3 });

    // Al abrir conv1 como anfitrión, los mensajes vienen más recientes primero y quedan leídos
    const opened = controller.getConversation(conv1.conversation.id, hostSession, '1', '1');
    expect(opened.messages.total).toBe(2);
    expect(opened.messages.totalPages).toBe(2);
    expect(opened.messages.data[0].content).toBe('Segundo mensaje en pub 1');
    expect(opened.messages.data[0].readAt).toBeDefined();

    // Contador baja de 2 a 1 conversación sin leer
    expect(controller.getUnreadCount(hostSession)).toEqual({ unreadConversations: 1, unreadMessages: 1 });

    // Marcar la otra conversación manualmente
    const readRes = controller.markAsRead(conv2.conversation.id, hostSession);
    expect(readRes).toEqual({ updated: 1, unreadConversations: 0 });
  });

  it('CA5: genera una sola notificación interna mientras haya mensajes sin leer en la conversación', () => {
    const conv = controller.startOrSend({ listingId: activeListingId, content: 'Primer mensaje' }, guestSession);
    controller.sendMessage(conv.conversation.id, { content: 'Segundo mensaje sin que lea' }, guestSession);

    const hostNotifsBeforeRead = notificationsService.findMine({ userId: hostSession.userId, email: hostSession.email });
    const msgNotifs1 = hostNotifsBeforeRead.filter((n) => n.type === 'MENSAJE_NUEVO');
    expect(msgNotifs1).toHaveLength(1);
    expect(msgNotifs1[0].entity).toBe('Conversation');
    expect(msgNotifs1[0].entityId).toBe(conv.conversation.id);

    // Anfitrión abre la conversación -> marca como leídos los pendientes
    controller.getConversation(conv.conversation.id, hostSession);

    // Huésped vuelve a escribir -> ahora sí vuelve a notificar una vez
    controller.sendMessage(conv.conversation.id, { content: 'Nuevo mensaje tras lectura' }, guestSession);
    const msgNotifs2 = notificationsService
      .findMine({ userId: hostSession.userId, email: hostSession.email })
      .filter((n) => n.type === 'MENSAJE_NUEVO');
    expect(msgNotifs2).toHaveLength(2);
  });

  it('CA6: rechaza mensajes vacíos, de solo espacios o mayores a 1000 caracteres', () => {
    expect(() => controller.startOrSend({ listingId: activeListingId, content: '' }, guestSession)).toThrow(
      BadRequestException,
    );
    expect(() => controller.startOrSend({ listingId: activeListingId, content: '    \n\t  ' }, guestSession)).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.startOrSend({ listingId: activeListingId, content: 'a'.repeat(1001) }, guestSession),
    ).toThrow(BadRequestException);
  });

  it('CA7 & RNF-025: terceros y administradores reciben 404 sin revelar existencia ni exponer correo/teléfono', () => {
    const created = controller.startOrSend({ listingId: activeListingId, content: 'Consulta privada' }, guestSession);
    const convJson = JSON.stringify(created);
    expect(convJson).not.toContain('carlos.host@stayhub.com');
    expect(convJson).not.toContain('laura.guest@stayhub.com');
    expect(convJson).not.toContain('300 111 2233');
    expect(convJson).not.toContain('310 555 8899');

    // Otro huésped
    expect(() => controller.getConversation(created.conversation.id, guest2Session)).toThrow(NotFoundException);
    expect(() =>
      controller.sendMessage(created.conversation.id, { content: 'Intento intruso' }, guest2Session),
    ).toThrow(NotFoundException);

    // Otro anfitrión
    expect(() => controller.getConversation(created.conversation.id, host2Session)).toThrow(NotFoundException);

    // Administrador tampoco puede leer ni escribir conversaciones huésped-anfitrión
    expect(controller.listMine(adminSession).data).toEqual([]);
    expect(() => controller.getConversation(created.conversation.id, adminSession)).toThrow(NotFoundException);
    expect(() =>
      controller.sendMessage(created.conversation.id, { content: 'Admin leyendo' }, adminSession),
    ).toThrow(NotFoundException);
    expect(() => controller.markAsRead(created.conversation.id, adminSession)).toThrow(NotFoundException);
    expect(controller.getUnreadCount(adminSession)).toEqual({ unreadConversations: 0, unreadMessages: 0 });
  });

  it('CA8: bloquea envío y no guarda el mensaje si la contraparte está restringida o desactivada', () => {
    const created = controller.startOrSend({ listingId: activeListingId, content: 'Mensaje inicial' }, guestSession);

    // Restringir cuenta del anfitrión
    authService.restrictAccount(hostSession.email, 'Incumplimiento de normas', adminSession.email);
    expect(() =>
      controller.sendMessage(created.conversation.id, { content: '¿Sigues ahí?' }, guestSession),
    ).toThrow(BadRequestException);

    // Levantar restricción al anfitrión y desactivar cuenta del huésped
    authService.unrestrictAccount(hostSession.userId, adminSession.email);
    const guestAcc = authService.findById(guestSession.userId)!;
    authService.deactivateAccount(guestAcc);

    expect(() =>
      controller.sendMessage(created.conversation.id, { content: 'Hola Laura' }, hostSession),
    ).toThrow(BadRequestException);

    // No se guardaron los mensajes fallidos (sigue habiendo solo 1)
    const detail = controller.getConversation(created.conversation.id, hostSession);
    expect(detail.messages.total).toBe(1);
  });

  it('Persistencia: sourceToRows y rowsToSource preservan conversaciones y mensajes en PostgreSQL', () => {
    expect(TABLE_DEFINITIONS.conversaciones).toBeDefined();
    expect(TABLE_DEFINITIONS.mensajes).toBeDefined();

    const created = controller.startOrSend({ listingId: activeListingId, content: 'Persistido en BD' }, guestSession);
    const dump = {
      conversations: (messagesService as any).conversations,
      messages: (messagesService as any).messages,
    };

    const rows = sourceToRows('messages', dump);
    expect(rows.conversaciones).toHaveLength(1);
    expect(rows.mensajes).toHaveLength(1);

    const restored = rowsToSource('messages', rows) as { conversations: any[]; messages: any[] };
    expect(restored.conversations[0].id).toBe(created.conversation.id);
    expect(restored.messages[0].content).toBe('Persistido en BD');
  });

  describe('HU-071 · Conversar por mensajes entre anfitrión y administrador (EP-18)', () => {
    it('CA1: anfitrión crea conversación con administración sin vínculo, por publicación o por reserva propia', () => {
      const general = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', content: 'Tengo una duda general sobre pagos.' },
        hostSession,
      );
      expect(general.conversation.channel).toBe('ANFITRION_ADMIN');
      expect(general.conversation.counterpartName).toBe('Administración');
      expect(general.conversation.listingId).toBe('ADMIN_GENERAL');

      const byListing = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', listingId: draftListingId, content: 'Necesito ayuda con la revisión.' },
        hostSession,
      );
      expect(byListing.conversation.listingId).toBe(draftListingId);
      expect(byListing.conversation.id).not.toBe(general.conversation.id);

      const bookingList = (bookingsService as any).bookingsStore as any[];
      bookingList.push({
        id: 'booking-hu071-1',
        listingId: activeListingId,
        guestId: guestSession.email,
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        guests: 2,
        totalAmount: 560000,
        currency: 'COP',
        status: 'CONFIRMADA',
        createdAt: new Date(),
      });

      const byBooking = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', bookingId: 'booking-hu071-1', content: 'Consulta sobre esta reserva.' },
        hostSession,
      );
      expect(byBooking.conversation.bookingId).toBe('booking-hu071-1');
      expect(byBooking.conversation.listingId).toBe(activeListingId);
    });

    it('CA2, CA3 & CA7: admin ve todas las conversaciones, responde como Administración, notifica al anfitrión y audita sin texto', async () => {
      // Crear una conversación huésped-anfitrión para confirmar que el admin NO la ve en su bandeja
      controller.startOrSend({ listingId: activeListingId, content: 'Mensaje privado huésped' }, guestSession);

      const c1 = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', listingId: activeListingId, content: 'Solicitud de soporte 1' },
        hostSession,
      );
      await new Promise((res) => setTimeout(res, 15));
      const host2Listing = listingsService.create(
        {
          title: 'Casa Host 2',
          city: 'Cali',
          department: 'Valle del Cauca',
          address: 'Calle 5 # 10-20',
          pricePerNight: 180000,
          maxGuests: 4,
        },
        host2Session,
      );
      const c2 = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', listingId: host2Listing.id, content: 'Solicitud de soporte 2' },
        host2Session,
      );

      const adminInbox = controller.listMine(adminSession);
      expect(adminInbox.total).toBe(2);
      expect(adminInbox.unreadConversations).toBe(2);
      // Lo más reciente primero
      expect(adminInbox.data[0].id).toBe(c2.conversation.id);
      expect(adminInbox.data.every((item) => item.channel === 'ANFITRION_ADMIN')).toBe(true);
      expect(controller.getUnreadCount(adminSession)).toEqual({ unreadConversations: 2, unreadMessages: 2 });

      // Admin abre c1 (marca como leído) y responde
      controller.getConversation(c1.conversation.id, adminSession);
      expect(controller.getUnreadCount(adminSession)).toEqual({ unreadConversations: 1, unreadMessages: 1 });

      const replyText = 'Revisamos tu publicación y ya puedes solicitar activación nuevamente.';
      const reply = controller.sendMessage(c1.conversation.id, { content: replyText }, adminSession);
      expect(reply.messages.data[0].senderRole).toBe('ADMINISTRADOR');
      expect(reply.messages.data[0].senderName).toBe('Administración');

      // CA3: anfitrión recibe notificación interna
      const hostNotifs = notificationsService
        .findMine({ userId: hostSession.userId, email: hostSession.email })
        .filter((n) => n.type === 'MENSAJE_NUEVO' && n.entityId === c1.conversation.id);
      expect(hostNotifs).toHaveLength(1);
      expect(hostNotifs[0].message).toContain('Administración');

      // CA7: evento de auditoría con admin, conversación y fecha, SIN el texto del mensaje
      const events = auditService.findAll();
      const chatAudit = events.find((e) => e.entity === 'Conversation' && e.entityId === c1.conversation.id);
      expect(chatAudit).toBeDefined();
      expect(chatAudit?.actor).toBe(adminSession.email);
      expect(chatAudit?.occurredAt).toBeDefined();
      expect(JSON.stringify(chatAudit)).not.toContain(replyText);
    });

    it('CA4: anfitrión ve sus conversaciones con administración y huéspedes, pero otro anfitrión recibe 404', () => {
      const adminConv = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', content: 'Duda privada del anfitrión 1' },
        hostSession,
      );
      controller.startOrSend({ listingId: activeListingId, content: 'Duda de huésped' }, guestSession);

      const hostInbox = controller.listMine(hostSession);
      expect(hostInbox.total).toBe(2);

      expect(() => controller.getConversation(adminConv.conversation.id, host2Session)).toThrow(NotFoundException);
      expect(() =>
        controller.sendMessage(adminConv.conversation.id, { content: 'Intento ajeno' }, host2Session),
      ).toThrow(NotFoundException);
    });

    it('CA5 & CA6: huésped es rechazado al intentar usar canal admin y se validan 1-1000 caracteres', () => {
      const adminConv = controller.startOrSend(
        { channel: 'ANFITRION_ADMIN', content: 'Consulta anfitrión' },
        hostSession,
      );

      expect(() =>
        controller.startOrSend({ channel: 'ANFITRION_ADMIN', content: 'Hola admin' }, guestSession),
      ).toThrow(ForbiddenException);
      expect(() => controller.getConversation(adminConv.conversation.id, guestSession)).toThrow(ForbiddenException);
      expect(() =>
        controller.sendMessage(adminConv.conversation.id, { content: 'Intento huésped' }, guestSession),
      ).toThrow(ForbiddenException);

      expect(() =>
        controller.startOrSend({ channel: 'ANFITRION_ADMIN', content: '   ' }, hostSession),
      ).toThrow(BadRequestException);
      expect(() =>
        controller.sendMessage(adminConv.conversation.id, { content: 'x'.repeat(1001) }, adminSession),
      ).toThrow(BadRequestException);
    });
  });

  it('Cobertura adicional HU-070: búsqueda por contexto, validaciones de entrada, bookingId y persistencia en memoria', () => {
    // Registro en StatePersistenceService (dump / restore null y con datos)
    let capturedHandlers: { dump: () => unknown; restore: (d: unknown) => void } | undefined;
    const persistenceMock = {
      register: (_name: string, handlers: { dump: () => unknown; restore: (d: unknown) => void }) => {
        capturedHandlers = handlers;
      },
    };
    const standalone = new MessagesService(undefined, undefined, undefined, undefined, persistenceMock as any);
    standalone.onModuleInit();
    expect(capturedHandlers?.dump()).toEqual({ conversations: [], messages: [] });
    capturedHandlers?.restore(null);
    capturedHandlers?.restore({ conversations: [], messages: [] });

    // Validación de tipo no string y rol inválido
    expect(() => controller.startOrSend({ listingId: activeListingId, content: 123 as any }, guestSession)).toThrow(
      BadRequestException,
    );
    expect(() =>
      messagesService.startOrSendMessage({ listingId: activeListingId, content: 'hola' }, { ...guestSession, role: 'OTRO' as any }),
    ).toThrow(NotFoundException);

    // Huésped sin listingId ni bookingId, listing inexistente, propia publicación y bookingId ajeno
    expect(() => controller.startOrSend({ content: 'sin destino' }, guestSession)).toThrow(BadRequestException);
    expect(() => controller.startOrSend({ listingId: 'list-no-existe', content: 'hola' }, guestSession)).toThrow(
      NotFoundException,
    );
    expect(() => controller.startOrSend({ bookingId: 'bk-no-existe', content: 'hola' }, guestSession)).toThrow(
      NotFoundException,
    );
    expect(() =>
      messagesService.startOrSendMessage(
        { listingId: activeListingId, content: 'Auto mensaje' },
        { ...guestSession, userId: hostSession.userId },
      ),
    ).toThrow(BadRequestException);

    // Huésped inicia conversación mediante bookingId válido
    const bookingId = 'booking-hu070-guest2';
    ((bookingsService as any).bookingsStore as any[]).push({
      id: bookingId,
      listingId: activeListingId,
      guestId: guest2Session.email,
      checkIn: '2027-03-10',
      checkOut: '2027-03-12',
      guests: 2,
      totalAmount: 560000,
      currency: 'COP',
      status: 'CONFIRMADA',
      createdAt: new Date(),
    });
    const byBooking = controller.startOrSend({ bookingId, content: 'Duda desde mi reserva' }, guest2Session);
    expect(byBooking.conversation.listingId).toBe(activeListingId);

    // lookup: por bookingId (huésped, anfitrión, tercero, inexistente), listingId y vacío
    expect(controller.lookup(guest2Session, undefined, bookingId)).toEqual({
      conversationId: byBooking.conversation.id,
    });
    expect(controller.lookup(hostSession, undefined, bookingId)).toEqual({
      conversationId: byBooking.conversation.id,
    });
    expect(controller.lookup(host2Session, undefined, bookingId)).toEqual({ conversationId: null });
    expect(controller.lookup(guest2Session, undefined, 'bk-no-existe')).toEqual({ conversationId: null });
    expect(controller.lookup(guest2Session, activeListingId)).toEqual({
      conversationId: byBooking.conversation.id,
    });
    expect(controller.lookup(guest2Session, draftListingId)).toEqual({ conversationId: null });
    expect(controller.lookup(guest2Session)).toEqual({ conversationId: null });

    // Validaciones de destino para anfitrión y rama listingId distinto en BookingsService
    expect(() => controller.startOrSend({ bookingId: 'bk-no-existe', content: 'Hola' }, hostSession)).toThrow(
      NotFoundException,
    );
    expect(() => controller.startOrSend({ listingId: activeListingId, content: 'Falta guestId' }, hostSession)).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.startOrSend({ listingId: 'list-no-existe', guestId: guest2Session.userId, content: 'Hola' }, hostSession),
    ).toThrow(NotFoundException);
    expect(() =>
      controller.startOrSend({ listingId: activeListingId, guestId: guest2Session.userId, content: 'Hola' }, host2Session),
    ).toThrow(NotFoundException);

    // Usuario sin cuenta registrada en AuthService -> resolveAccount retorna undefined pero funciona para reserva externa
    expect(bookingsService.hasGuestBookingWithHostListing(draftListingId, { email: guest2Session.email })).toBe(false);
    expect(bookingsService.getBookingForMessaging('bk-no-existe')).toBeUndefined();
    const externalGuestConv = controller.startOrSend(
      { listingId: activeListingId, guestId: guest2Session.email, content: 'Confirmado' },
      hostSession,
    );
    expect(externalGuestConv.conversation.id).toBe(byBooking.conversation.id);
    controller.sendMessage(externalGuestConv.conversation.id, { content: 'Otra pregunta' }, guest2Session);

    // markAsRead explícito y consulta con paginación
    const readRes = controller.markAsRead(byBooking.conversation.id, hostSession);
    expect(readRes.updated).toBeGreaterThanOrEqual(1);
    const paged = controller.getConversation(byBooking.conversation.id, hostSession, '1', '5');
    expect(paged.messages.limit).toBe(5);
  });
});
