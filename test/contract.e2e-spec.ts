import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { AppModule } from '../src/app.module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// HU-010: las imágenes subidas en las pruebas van a una carpeta temporal.
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'stayhub-e2e-uploads-'));

describe('HU-066 · Contratos OpenAPI y Flujo E2E por Servicio', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authToken: string;
  /** RF-041: las reservas las crea una cuenta de huésped (authToken es de un anfitrión). */
  let guestBookingToken: string;
  let listingId: string;
  let bookingId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createAppValidationPipe());

    await app.listen(0);
    const url = await app.getUrl();
    baseUrl = `${url.replace('[::1]', '127.0.0.1')}/api`;

    const guest = { name: 'Huésped Contrato', email: 'huesped.contrato@stayhub.com', password: 'Password123', role: 'HUESPED' };
    const json = { 'Content-Type': 'application/json' };
    await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(guest) });
    guestBookingToken = (
      await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: guest.email, password: guest.password }) })).json()
    ).token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CA1 · Contrato OpenAPI 3.0', () => {
    it('debe generar un documento OpenAPI válido con todos los servicios y esquemas DTO', () => {
      const config = new DocumentBuilder()
        .setTitle('Inversiones LR - API Marketplace')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();

      const document = SwaggerModule.createDocument(app, config);

      expect(document.openapi).toMatch(/^3\.0/);
      expect(document.paths['/api/auth/register']).toBeDefined();
      expect(document.paths['/api/auth/login']).toBeDefined();
      expect(document.paths['/api/listings']).toBeDefined();
      expect(document.paths['/api/listings/search']).toBeDefined();
      expect(document.paths['/api/listings/{id}']).toBeDefined();
      expect(document.paths['/api/listings/{id}/availability']).toBeDefined();
      expect(document.paths['/api/bookings/quote']).toBeDefined();
      expect(document.paths['/api/bookings/instant']).toBeDefined();
      expect(document.paths['/api/bookings/{id}']).toBeDefined();

      const schemas = Object.keys(document.components?.schemas || {});
      expect(schemas).toEqual(
        expect.arrayContaining([
          'LoginDto',
          'RegisterDto',
          'LoginResponseDto',
          'RegisterResponseDto',
          'CreateListingDto',
          'ListingResponseDto',
          'PaginatedListingsResponseDto',
          'AvailabilityResponseDto',
          'QuoteBookingDto',
          'QuoteResponseDto',
          'CreateBookingDto',
          'BookingResponseDto',
        ]),
      );
    });
  });

  describe('CA2 · Flujo E2E contra el contrato (Auth -> Listings -> Bookings)', () => {
    it('1.1 POST /api/auth/register responde 201 según RegisterResponseDto', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Miguel Ángel Alza',
          email: 'miguel@stayhub.com',
          password: 'Password123!',
          role: 'ANFITRION',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          user: expect.objectContaining({
            email: 'miguel@stayhub.com',
            role: 'ANFITRION',
          }),
        }),
      );
    });

    it('1.2 POST /api/auth/login responde 200 según LoginResponseDto', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'miguel@stayhub.com',
          password: 'Password123!',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          message: expect.any(String),
          token: expect.any(String),
        }),
      );
      authToken = body.token;
    });

    it('2.1 POST /api/listings responde 201 según ListingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: 'Hermosa cabaña en la montaña',
          description: 'Cabaña espaciosa con vista panorámica, chimenea y jacuzzi.',
          address: 'Calle 10 # 43-20',
          city: 'Medellín',
          country: 'Colombia',
          pricePerNight: 85.5,
          maxGuests: 4,
          bedrooms: 2,
          bathrooms: 2,
          amenities: ['WIFI', 'POOL'],
          images: ['https://storage.stayhub.com/img1.jpg'],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: 'Hermosa cabaña en la montaña',
          city: 'Medellín',
          pricePerNight: 85.5,
          hostId: expect.any(String),
        }),
      );
      listingId = body.id;
    });

    it('2.2 GET /api/listings/search responde 200 según PaginatedListingsResponseDto', async () => {
      const res = await fetch(`${baseUrl}/listings/search?city=Medellin&guests=2&page=1&limit=10`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toEqual(
        expect.objectContaining({
          total: expect.any(Number),
          page: 1,
          totalPages: expect.any(Number),
        }),
      );
    });

    it('2.3 GET /api/listings/:id/availability responde 200 según AvailabilityResponseDto', async () => {
      const res = await fetch(
        `${baseUrl}/listings/${listingId}/availability?startDate=2026-11-01&endDate=2026-11-06`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(body.blockedDates)).toBe(true);
      expect(body).toEqual(
        expect.objectContaining({
          listingId,
          isAvailable: expect.any(Boolean),
          pricePerNight: expect.any(Number),
        }),
      );
    });

    it('2.4 GET /api/listings/:id responde 200 según ListingDetailDto para su anfitrión', async () => {
      const res = await fetch(`${baseUrl}/listings/${listingId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          id: listingId,
          title: expect.any(String),
          pricePerNight: expect.any(Number),
        }),
      );
    });

    it('3.1 POST /api/bookings/quote responde 200 según QuoteResponseDto', async () => {
      // HU-028: solo se cotizan fechas disponibles; se habilita un periodo desde mañana.
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await fetch(`${baseUrl}/listings/${listingId}/availability-periods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ startDate: day(1), endDate: day(60) }),
      });
      const res = await fetch(`${baseUrl}/bookings/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          checkIn: day(10),
          checkOut: day(15),
          guests: 2,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          listingId,
          nights: 5,
          nightlyRate: expect.any(Number),
          baseAmount: expect.any(Number),
          cleaningFee: expect.any(Number),
          serviceFee: expect.any(Number),
          totalAmount: expect.any(Number),
          currency: 'COP',
        }),
      );
    });

    it('3.2 POST /api/bookings/instant responde 201 según BookingResponseDto', async () => {
      // HU-030: solo se reservan publicaciones ACTIVAS; Chapinero (demo) está activa y disponible en diciembre.
      const activeListingId = 'demo-bogota-chapinero';
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestBookingToken}`,
        },
        body: JSON.stringify({
          listingId: activeListingId,
          checkIn: '2026-12-01',
          checkOut: '2026-12-04',
          guests: 2,
          specialRequests: 'Llegaremos a las 10 PM.',
          idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          listingId: activeListingId,
          guests: 2,
          totalAmount: expect.any(Number),
          status: 'PENDIENTE',
          idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        }),
      );
      bookingId = body.id;
    });

    it('3.3 GET /api/bookings/:id responde 200 según BookingResponseDto', async () => {
      const res = await fetch(`${baseUrl}/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${guestBookingToken}` },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          id: bookingId,
          status: expect.any(String),
          totalAmount: expect.any(Number),
        }),
      );
    });

    it('4.1 HU-003 (CA1): GET /api/bookings/my sin sesión responde 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/bookings/my`);
      expect(res.status).toBe(401);
    });

    it('4.2 HU-003 (CA2): HUÉSPED intentando usar función de ANFITRIÓN o ADMINISTRADOR recibe 403 Forbidden', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Visitante Huésped',
          email: 'huesped@stayhub.com',
          password: 'Password123!',
          role: 'HUESPED',
        }),
      });

      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'huesped@stayhub.com',
          password: 'Password123!',
        }),
      });
      const { token: guestToken } = await loginRes.json();

      const hostEndpointRes = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({
          title: 'Intento no autorizado',
          description: 'Intento de publicar siendo huésped',
          address: 'Calle 10',
          city: 'Bogotá',
          country: 'Colombia',
          pricePerNight: 100,
          maxGuests: 2,
          bedrooms: 1,
          bathrooms: 1,
        }),
      });
      expect(hostEndpointRes.status).toBe(403);

      const adminEndpointRes = await fetch(`${baseUrl}/auth/admin/audit`, {
        headers: { Authorization: `Bearer ${guestToken}` },
      });
      expect(adminEndpointRes.status).toBe(403);
    });

    it('4.3 HU-003 (CA3): Visitante sin sesión puede ver búsqueda, detalle y reseñas de una publicación', async () => {
      const reviewsRes = await fetch(`${baseUrl}/listings/${listingId}/reviews`);
      const reviewsBody = await reviewsRes.json();

      expect(reviewsRes.status).toBe(200);
      expect(reviewsBody.listingId).toBe(listingId);
      expect(Array.isArray(reviewsBody.reviews)).toBe(true);
    });
  });
  describe('HU-061 · Registrar los eventos de auditoría (CA1, CA2, CA3)', () => {
    const adminEmail = process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!';
    let adminToken: string;

    beforeAll(async () => {
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      adminToken = (await loginRes.json()).token;
    });

    it('5.1 (CA1, CA3): GET /api/audit/events lista eventos completos, incluido el login fallido', async () => {
      await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'ClaveIncorrecta1' }),
      });

      const res = await fetch(`${baseUrl}/audit/events?action=LOGIN&result=FALLIDO`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const { data: events } = await res.json();

      expect(res.status).toBe(200);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toEqual(
        expect.objectContaining({
          actor: adminEmail,
          action: 'LOGIN',
          entity: 'AuthSession',
          occurredAt: expect.any(String),
          result: 'FALLIDO',
        }),
      );
    });

    it('5.2 (CA2): PUT, PATCH y DELETE sobre /api/audit/events/:id responden 405', async () => {
      const listRes = await fetch(`${baseUrl}/audit/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const [firstEvent] = (await listRes.json()).data;

      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await fetch(`${baseUrl}/audit/events/${firstEvent.id}`, {
          method,
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(405);
      }

      const afterRes = await fetch(`${baseUrl}/audit/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const after = (await afterRes.json()).data;
      expect(after.find((event: { id: string }) => event.id === firstEvent.id)).toEqual(firstEvent);
      expect(after.slice(0, 3).map((event: { action: string }) => event.action)).toEqual([
        'AUDIT_TAMPER_ATTEMPT',
        'AUDIT_TAMPER_ATTEMPT',
        'AUDIT_TAMPER_ATTEMPT',
      ]);
    });

    it('5.3 GET /api/audit/events es exclusivo del ADMINISTRADOR', async () => {
      const res = await fetch(`${baseUrl}/audit/events`);
      expect(res.status).toBe(401);
    });
  });
  describe('HU-004 · Recuperar la contraseña (simulado) (CA1, CA2, CA3, CA4)', () => {
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('6.1 solicita, lee el buzón simulado, cambia la contraseña y rechaza el token reutilizado', async () => {
      const email = 'recupera.e2e@stayhub.com';
      await post('/auth/register', {
        name: 'Recupera E2E',
        email,
        password: 'Password123',
        role: 'HUESPED',
      });

      const known = await post('/auth/password-recovery', { email });
      const unknown = await post('/auth/password-recovery', { email: 'nadie.e2e@stayhub.com' });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual(await known.json());

      const mailboxRes = await fetch(`${baseUrl}/auth/password-recovery/mailbox?email=${email}`);
      const [mail] = await mailboxRes.json();
      expect(mail).toEqual(
        expect.objectContaining({ to: email, token: expect.any(String), expiresAt: expect.any(String) }),
      );

      const resetRes = await post('/auth/password-recovery/reset', {
        token: mail.token,
        newPassword: 'NuevaClave2026',
      });
      expect(resetRes.status).toBe(200);

      const loginRes = await post('/auth/login', { email, password: 'NuevaClave2026' });
      expect(loginRes.status).toBe(200);

      const reuseRes = await post('/auth/password-recovery/reset', {
        token: mail.token,
        newPassword: 'OtraClave2026',
      });
      expect(reuseRes.status).toBe(400);
      expect((await reuseRes.json()).canRequestNewToken).toBe(true);
    });
  });
  describe('HU-010 · Crear una publicación en borrador (CA1, CA2, CA3, CA4)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const createListing = (token: string, body: unknown) =>
      fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    it('7.1 (CA1, CA4) el anfitrión crea borradores asociados a él, completos o incompletos', async () => {
      const token = await loginAs('anfitrion.hu010@stayhub.com', 'ANFITRION');

      const completeRes = await createListing(token, {
        title: 'Cabaña del Bosque',
        description: 'Cabaña de madera con chimenea.',
        city: 'Guatapé',
        department: 'Antioquia',
        address: 'Vereda El Roble',
        propertyType: 'CABANA',
        maxGuests: 4,
        pricePerNight: 320000,
        amenities: ['WIFI'],
        rules: ['No fumar'],
        images: ['https://storage.stayhub.com/cabana-1.jpg'],
      });
      const complete = await completeRes.json();
      expect(completeRes.status).toBe(201);
      expect(complete).toMatchObject({ status: 'BORRADOR', isComplete: true, missingFields: [] });

      const titleOnlyRes = await createListing(token, { title: 'Apartamento en Laureles' });
      const titleOnly = await titleOnlyRes.json();
      expect(titleOnlyRes.status).toBe(201);
      expect(titleOnly).toMatchObject({ status: 'BORRADOR', isComplete: false });
      expect(titleOnly.missingFields).toContain('pricePerNight');

      const mineRes = await fetch(`${baseUrl}/listings/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const mine = await mineRes.json();
      expect(mine.map((item: { id: string }) => item.id)).toEqual([titleOnly.id, complete.id]);
    });

    it('7.2 (CA2) rechaza capacidad 0 y precio <= 0 con mensaje por campo', async () => {
      const token = await loginAs('anfitrion2.hu010@stayhub.com', 'ANFITRION');
      const res = await createListing(token, { title: 'Cabaña del Bosque', maxGuests: 0, pricePerNight: 0 });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.fieldErrors).toEqual({
        maxGuests: ['La capacidad debe ser mayor que 0'],
        pricePerNight: ['El precio por noche debe ser mayor que 0'],
      });
    });

    it('7.3 (CA3) el huésped no puede crear publicaciones', async () => {
      const token = await loginAs('huesped.hu010@stayhub.com', 'HUESPED');
      const res = await createListing(token, { title: 'Intento de huésped' });
      expect(res.status).toBe(403);
    });

    it('7.4 (RN-001, RN-002) el administrador tampoco puede crear publicaciones', async () => {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      const { token } = await login.json();
      const res = await createListing(token, { title: 'Intento del administrador' });
      expect(res.status).toBe(403);
    });
  });

  describe('HU-012 · Consultar mis publicaciones (CA1, CA2, RF-016, RN-005)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const getMine = (token: string) =>
      fetch(`${baseUrl}/listings/mine`, { headers: { Authorization: `Bearer ${token}` } });

    it('8.1 (CA1, RN-005) el anfitrión ve solo sus publicaciones con título, ciudad, precio y estado', async () => {
      const token = await loginAs('anfitrion.hu012@stayhub.com', 'ANFITRION');
      const otherToken = await loginAs('otro.hu012@stayhub.com', 'ANFITRION');
      await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: 'Cabaña del Bosque', city: 'Guatapé', pricePerNight: 320000 }),
      });

      const res = await getMine(token);
      const mine = await res.json();
      expect(res.status).toBe(200);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        title: 'Cabaña del Bosque',
        city: 'Guatapé',
        pricePerNight: 320000,
        status: 'BORRADOR',
        statusLabel: 'Borrador',
      });
      expect(mine[0]).not.toHaveProperty('adminReason');

      expect(await (await getMine(otherToken)).json()).toEqual([]);
    });

    it('8.2 el listado exige sesión de anfitrión', async () => {
      expect((await fetch(`${baseUrl}/listings/mine`)).status).toBe(401);
      const guestToken = await loginAs('huesped.hu012@stayhub.com', 'HUESPED');
      expect((await getMine(guestToken)).status).toBe(403);
    });
  });

  describe('HU-013 · Solicitar la activación de mi publicación (CA1, CA2, CA3, RF-017)', () => {
    const json = { 'Content-Type': 'application/json' };
    const login = async (email: string, password: string) =>
      (
        await (
          await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ email, password }),
          })
        ).json()
      ).token as string;
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      return login(email, 'Password123');
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const createListing = async (token: string, body: unknown) =>
      (await (await fetch(`${baseUrl}/listings`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) })).json()) as {
        id: string;
      };
    const requestActivation = (token: string, id: string) =>
      fetch(`${baseUrl}/listings/${id}/request-activation`, { method: 'PATCH', headers: auth(token) });
    const completeDraft = {
      title: 'Cabaña del Bosque',
      description: 'Cabaña de madera con chimenea.',
      city: 'Guatapé',
      department: 'Antioquia',
      address: 'Vereda El Roble',
      propertyType: 'CABANA',
      maxGuests: 4,
      pricePerNight: 320000,
      amenities: ['WIFI'],
      rules: ['No fumar'],
      images: ['https://storage.stayhub.com/cabana-1.jpg'],
    };

    it('9.1 (CA1, CA3) la publicación completa pasa a PENDIENTE_REVISION, se ve en Mis publicaciones y queda en la auditoría', async () => {
      const token = await registerAndLogin('anfitrion.hu013@stayhub.com', 'ANFITRION');
      const listing = await createListing(token, completeDraft);

      const res = await requestActivation(token, listing.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: listing.id, status: 'PENDIENTE_REVISION' });

      const mine = await (await fetch(`${baseUrl}/listings/mine`, { headers: auth(token) })).json();
      expect(mine[0]).toMatchObject({ id: listing.id, status: 'PENDIENTE_REVISION' });

      const adminToken = await login(
        process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
        process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
      );
      const pending = await (await fetch(`${baseUrl}/listings/pending`, { headers: auth(adminToken) })).json();
      expect(pending.map((item: { id: string }) => item.id)).toContain(listing.id);

      const events = await (
        await fetch(`${baseUrl}/audit/events?action=LISTING_STATUS_CHANGE&limit=100`, { headers: auth(adminToken) })
      ).json();
      const items = events.data;
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: listing.id,
            result: 'EXITOSO',
            detail: 'BORRADOR -> PENDIENTE_REVISION (solicitud de activación)',
          }),
        ]),
      );
    });

    it('9.2 (CA2) rechaza la publicación incompleta y lista los campos faltantes', async () => {
      const token = await registerAndLogin('anfitrion2.hu013@stayhub.com', 'ANFITRION');
      const listing = await createListing(token, { ...completeDraft, images: [], pricePerNight: undefined });

      const res = await requestActivation(token, listing.id);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.missingFields).toEqual(['pricePerNight', 'images']);
      expect(body.missingFieldLabels).toEqual(['precio por noche', 'al menos una imagen']);
    });

    it('9.3 (RN-005) otro anfitrión recibe 404 y el huésped 403', async () => {
      const owner = await registerAndLogin('anfitrion3.hu013@stayhub.com', 'ANFITRION');
      const other = await registerAndLogin('otro.hu013@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu013@stayhub.com', 'HUESPED');
      const listing = await createListing(owner, completeDraft);

      expect((await requestActivation(other, listing.id)).status).toBe(404);
      expect((await requestActivation(guest, listing.id)).status).toBe(403);
    });
  });
  describe('HU-019 · Registrar periodos disponibles (CA1, CA2, CA3, RF-025)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const createListing = async (token: string) =>
      (
        await (
          await fetch(`${baseUrl}/listings`, {
            method: 'POST',
            headers: auth(token),
            body: JSON.stringify({ title: 'Cabaña del Bosque', city: 'Guatapé' }),
          })
        ).json()
      ).id as string;
    const registerPeriod = (token: string, id: string, startDate: string, endDate: string) =>
      fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ startDate, endDate }),
      });

    it('10.1 (CA1) registra el periodo, lo lista y queda disponible para reservas', async () => {
      const token = await registerAndLogin('anfitrion.hu019@stayhub.com', 'ANFITRION');
      const id = await createListing(token);

      const res = await registerPeriod(token, id, '2027-03-01', '2027-03-15');
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ listingId: id, availableForBooking: true });

      const periods = await (await fetch(`${baseUrl}/listings/${id}/availability-periods`, { headers: auth(token) })).json();
      expect(periods).toHaveLength(1);

      const availability = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-05&endDate=2027-03-10`)
      ).json();
      expect(availability.isAvailable).toBe(true);
    });

    it('10.2 (CA2, CA3) rechaza fechas inválidas o pasadas y la superposición indicando el periodo existente', async () => {
      const token = await registerAndLogin('anfitrion2.hu019@stayhub.com', 'ANFITRION');
      const id = await createListing(token);
      await registerPeriod(token, id, '2027-06-10', '2027-06-20');

      expect((await registerPeriod(token, id, '2027-05-10', '2027-05-05')).status).toBe(400);
      expect((await registerPeriod(token, id, '2020-01-01', '2020-01-10')).status).toBe(400);

      const overlap = await registerPeriod(token, id, '2027-06-15', '2027-06-25');
      expect(overlap.status).toBe(400);
      expect(await overlap.json()).toMatchObject({
        conflictingPeriod: { startDate: '2027-06-10', endDate: '2027-06-20' },
      });
    });

    it('10.3 otro anfitrión recibe 404 y el huésped 403', async () => {
      const owner = await registerAndLogin('anfitrion3.hu019@stayhub.com', 'ANFITRION');
      const other = await registerAndLogin('otro.hu019@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu019@stayhub.com', 'HUESPED');
      const id = await createListing(owner);

      expect((await registerPeriod(other, id, '2027-03-01', '2027-03-15')).status).toBe(404);
      expect((await registerPeriod(guest, id, '2027-03-01', '2027-03-15')).status).toBe(403);
    });
  });

  describe('HU-020 · Modificar periodos sin afectar reservas (CA1, CA2, RF-026, RN-011)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const createListing = async (token: string) =>
      (
        await (
          await fetch(`${baseUrl}/listings`, {
            method: 'POST',
            headers: auth(token),
            body: JSON.stringify({ title: 'Cabaña Campestre HU-020', city: 'Guatapé' }),
          })
        ).json()
      ).id as string;
    const registerPeriod = async (token: string, id: string, startDate: string, endDate: string) =>
      (
        await (
          await fetch(`${baseUrl}/listings/${id}/availability-periods`, {
            method: 'POST',
            headers: auth(token),
            body: JSON.stringify({ startDate, endDate }),
          })
        ).json()
      ).id as string;

    it('CA1: modifica o elimina periodos sin reservas dejando no disponibles las fechas retiradas', async () => {
      const token = await registerAndLogin('anfitrion.hu020.ca1@stayhub.com', 'ANFITRION');
      const id = await createListing(token);
      const periodId = await registerPeriod(token, id, '2027-05-01', '2027-05-20');

      // Reduce periodo a 05-05 al 05-15
      const updateRes = await fetch(`${baseUrl}/listings/${id}/availability-periods/${periodId}`, {
        method: 'PATCH',
        headers: auth(token),
        body: JSON.stringify({ startDate: '2027-05-05', endDate: '2027-05-15' }),
      });
      expect(updateRes.status).toBe(200);

      const availRetired = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-05-01&endDate=2027-05-04`)
      ).json();
      expect(availRetired.isAvailable).toBe(false);

      // Elimina periodo
      const delRes = await fetch(`${baseUrl}/listings/${id}/availability-periods/${periodId}`, {
        method: 'DELETE',
        headers: auth(token),
      });
      expect(delRes.status).toBe(200);

      const availDel = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-05-06&endDate=2027-05-10`)
      ).json();
      expect(availDel.isAvailable).toBe(false);
    });

    it('CA2: impide retirar fechas que contienen reservas confirmadas e indica reservas afectadas', async () => {
      const hostToken = await registerAndLogin('anfitrion.hu020.ca2@stayhub.com', 'ANFITRION');
      const guestToken = await registerAndLogin('huesped.hu020.ca2@stayhub.com', 'HUESPED');
      const id = await createListing(hostToken);

      const periodId = await registerPeriod(hostToken, id, '2027-06-01', '2027-06-30');

      // Registrar periodo reservado confirmado (HU-023) del 10 al 15
      const blockRes = await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(hostToken),
        body: JSON.stringify({
          checkIn: '2027-06-10',
          checkOut: '2027-06-15',
          bookingId: 'booking-hu020-e2e',
          type: 'RESERVA',
        }),
      });
      expect(blockRes.status).toBe(201);

      // Intenta eliminar el periodo -> 400 con affectedBookings
      const delRes = await fetch(`${baseUrl}/listings/${id}/availability-periods/${periodId}`, {
        method: 'DELETE',
        headers: auth(hostToken),
      });
      expect(delRes.status).toBe(400);
      const delBody = await delRes.json();
      expect(delBody.message).toMatch(/reservas confirmadas/);
      expect(delBody.affectedBookings).toBeDefined();

      // Intenta reducir retirando las fechas de la reserva (ej: fin al 08) -> 400
      const patchRes = await fetch(`${baseUrl}/listings/${id}/availability-periods/${periodId}`, {
        method: 'PATCH',
        headers: auth(hostToken),
        body: JSON.stringify({ endDate: '2027-06-08' }),
      });
      expect(patchRes.status).toBe(400);
      const patchBody = await patchRes.json();
      expect(patchBody.message).toMatch(/reservas confirmadas/);
      expect(patchBody.affectedBookings).toBeDefined();
    });
  });

  describe('HU-006 · Consultar mi perfil (CA1, CA2, RF-009)', () => {
    const json = { 'Content-Type': 'application/json' };
    const register = (email: string, phone?: string) =>
      fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Laura Gómez', email, password: 'Password123', role: 'HUESPED', phone }),
      });
    const login = async (email: string) => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()) as { token: string; user: { id: string } };
    };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('11.1 (CA1) GET /api/users/me responde nombre, correo, teléfono, rol y estado', async () => {
      await register('laura.hu006@stayhub.com', '+57 300 123 4567');
      const { token } = await login('laura.hu006@stayhub.com');

      const res = await fetch(`${baseUrl}/users/me`, { headers: auth(token) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        name: 'Laura Gómez',
        email: 'laura.hu006@stayhub.com',
        phone: '+57 300 123 4567',
        role: 'HUESPED',
        status: 'ACTIVA',
      });
      expect((await fetch(`${baseUrl}/users/me`)).status).toBe(401);
    });

    it('11.2 (CA2) consultar el perfil de otro usuario por su id responde 403', async () => {
      await register('mia.hu006@stayhub.com');
      await register('otro.hu006@stayhub.com');
      const mine = await login('mia.hu006@stayhub.com');
      const other = await login('otro.hu006@stayhub.com');

      expect((await fetch(`${baseUrl}/users/${mine.user.id}`, { headers: auth(mine.token) })).status).toBe(200);
      expect((await fetch(`${baseUrl}/users/${other.user.id}`, { headers: auth(mine.token) })).status).toBe(403);
    });

    it('11.3 el registro rechaza un teléfono inválido', async () => {
      expect((await register('telefono.hu006@stayhub.com', 'abc123')).status).toBe(400);
    });
  });

  describe('HU-007 · Actualizar mi perfil (CA1, CA2, CA3, RF-010, RN-021)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Laura Gómez', email, password: 'Password123', role: 'HUESPED' }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const patch = (path: string, token: string, body: object) =>
      fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    it('12.1 (CA1) PATCH /api/users/me actualiza nombre y teléfono y se ve en GET /api/users/me', async () => {
      const token = await registerAndLogin('laura.hu007@stayhub.com');

      const res = await patch('/users/me', token, { name: 'Laura Gómez Ruiz', phone: '3001234567' });
      expect(res.status).toBe(200);

      const me = await (await fetch(`${baseUrl}/users/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
      expect(me).toMatchObject({ name: 'Laura Gómez Ruiz', phone: '3001234567' });
    });

    it('12.2 (CA2) PATCH /api/users/me/password exige la actual y una nueva que cumpla la política', async () => {
      const token = await registerAndLogin('clave.hu007@stayhub.com');

      expect((await patch('/users/me/password', token, { currentPassword: 'Mala12345', newPassword: 'NuevaClave2026' })).status).toBe(400);
      expect((await patch('/users/me/password', token, { currentPassword: 'Password123', newPassword: 'corta' })).status).toBe(400);
      expect((await patch('/users/me/password', token, { currentPassword: 'Password123', newPassword: 'NuevaClave2026' })).status).toBe(200);

      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: 'clave.hu007@stayhub.com', password: 'NuevaClave2026' }),
      });
      expect(login.status).toBe(200);
    });

    it('12.3 (CA3) el correo y el rol no se pueden editar', async () => {
      const token = await registerAndLogin('fijo.hu007@stayhub.com');

      const res = await patch('/users/me', token, { email: 'otro.hu007@stayhub.com', role: 'ADMINISTRADOR' });
      expect(res.status).toBe(400);
      expect((await res.json()).fieldErrors).toMatchObject({
        email: ['El correo electrónico no se puede editar'],
        role: ['El rol no se puede editar'],
      });
    });
  });

  describe('HU-023 · Bloquear automáticamente el periodo reservado (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028, AMB-09)', () => {
    const json = { 'Content-Type': 'application/json' };
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });

    it('13.1 (CA1, CA2, CA3) bloquea las noches [10, 12) -> 10 y 11 no disponibles; 12 al 14 disponible; cualquier cruce no disponible', async () => {
      const token = await registerAndLogin('anfitrion.hu023@stayhub.com', 'ANFITRION');
      const listingRes = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ title: 'Villa del Lago HU-023', city: 'Guatapé' }),
      });
      const { id } = (await listingRes.json()) as { id: string };

      await fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ startDate: '2027-03-01', endDate: '2027-03-31' }),
      });

      // CA1: Confirmar reserva del 10 al 12 bloquea las noches 10 y 11
      const blockRes = await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ checkIn: '2027-03-10', checkOut: '2027-03-12', bookingId: 'booking-hu023' }),
      });
      expect(blockRes.status).toBe(201);
      expect(await blockRes.json()).toMatchObject({
        listingId: id,
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        blockedNights: ['2027-03-10', '2027-03-11'],
      });

      const check10To12 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-10&endDate=2027-03-12`)
      ).json();
      expect(check10To12).toMatchObject({
        isAvailable: false,
        blockedDates: ['2027-03-10', '2027-03-11'],
      });

      // CA2: Del 12 al 14 aparece disponible porque el día de salida puede ser llegada de otra reserva
      const check12To14 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-12&endDate=2027-03-14`)
      ).json();
      expect(check12To14).toMatchObject({
        isAvailable: true,
        blockedDates: [],
      });

      // CA3: Un rango que incluye una noche reservada o bloqueada (ej. 11 al 13 incluye noche 11) es no disponible
      const check11To13 = await (
        await fetch(`${baseUrl}/listings/${id}/availability?startDate=2027-03-11&endDate=2027-03-13`)
      ).json();
      expect(check11To13).toMatchObject({
        isAvailable: false,
        blockedDates: ['2027-03-11'],
      });
    });
  });

  describe('HU-024 · Buscar por ciudad, fechas y huéspedes (CA1, CA2, CA3, CA4, RF-031, RF-033)', () => {
    const search = (query: string) => fetch(`${baseUrl}/listings/search?${query}`);
    const ids = async (query: string) => {
      const body = await (await search(query)).json();
      return (body.data as Array<{ id: string }>).map((item) => item.id).sort();
    };

    it('13.1 (CA1, CA2) Bogotá del 10 al 13 de noviembre para 2 huéspedes, sin sesión', async () => {
      expect(await ids('city=Bogot%C3%A1&checkIn=2026-11-10&checkOut=2026-11-13&guests=2&limit=50')).toEqual([
        'demo-bogota-candelaria',
        'demo-bogota-chapinero',
      ]);
      expect(await ids('city=bogota&checkIn=2026-11-10&checkOut=2026-11-13&guests=2&limit=50')).toHaveLength(2);
    });

    it('13.2 (CA3) salida igual o anterior a la llegada responde 400', async () => {
      const res = await search('city=Bogota&checkIn=2026-11-13&checkOut=2026-11-10&guests=2');
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe('La fecha de salida debe ser posterior a la fecha de llegada');
      expect((await search('city=Bogota&checkIn=2026-11-10')).status).toBe(400);
    });

    it('13.3 (CA4) sin fechas devuelve las ACTIVAS sin filtrar por disponibilidad', async () => {
      expect(await ids('city=Bogota&guests=2&limit=50')).toEqual([
        'demo-bogota-candelaria',
        'demo-bogota-chapinero',
        'demo-bogota-chico',
        'demo-bogota-teusaquillo',
      ]);
    });
  });

  describe('HU-010 · Subir imágenes de la publicación desde el dispositivo', () => {
    const json = { 'Content-Type': 'application/json' };
    const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Ana Anfitriona', email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const upload = (token: string, files: Array<[Uint8Array, string]>) => {
      const form = new FormData();
      for (const [bytes, name] of files) {
        form.append('images', new Blob([Buffer.from(bytes)], { type: 'image/jpeg' }), name);
      }
      return fetch(`${baseUrl}/listings/images`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };

    it('14.1 el anfitrión sube una imagen, la usa en su publicación y cualquiera puede verla', async () => {
      const token = await registerAndLogin('fotos.hu010@stayhub.com', 'ANFITRION');

      const res = await upload(token, [[JPG, 'sala.jpg']]);
      expect(res.status).toBe(201);
      const { urls } = await res.json();
      expect(urls[0]).toMatch(/^\/api\/listings\/images\/[0-9a-f-]{36}\.jpg$/);

      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: 'Cabaña con fotos propias', images: urls }),
      });
      expect((await created.json()).images).toEqual(urls);

      const image = await fetch(`${baseUrl}${urls[0].replace('/api', '')}`);
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/jpeg');
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPG);
    });

    it('14.2 rechaza archivos que no son imágenes, de más de 5 MB, y al huésped', async () => {
      const host = await registerAndLogin('fotos2.hu010@stayhub.com', 'ANFITRION');
      const guest = await registerAndLogin('huesped.hu010@stayhub.com', 'HUESPED');

      expect((await upload(host, [[new TextEncoder().encode('no soy imagen'), 'falsa.jpg']])).status).toBe(400);
      const big = new Uint8Array(5 * 1024 * 1024 + 1);
      big.set(JPG);
      expect((await upload(host, [[big, 'grande.jpg']])).status).toBe(413);
      expect((await upload(guest, [[JPG, 'sala.jpg']])).status).toBe(403);
      expect((await fetch(`${baseUrl}/listings/images/no-existe.jpg`)).status).toBe(404);
    });
  });

  describe('HU-026 · Consultar el detalle de una publicación (CA1, CA2, RF-034, RN-006)', () => {
    const json = { 'Content-Type': 'application/json' };
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const detail = (id: string, token?: string) =>
      fetch(`${baseUrl}/listings/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    it('15.1 (CA1) un visitante ve el detalle completo de una publicación ACTIVA', async () => {
      const res = await detail('demo-bogota-chapinero');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        title: 'Apartamento en Chapinero Alto',
        location: { city: 'Bogotá', text: expect.stringContaining('Chapinero Alto, Bogotá, Cundinamarca') },
        propertyTypeLabel: 'Apartamento',
        maxGuests: 2,
        pricePerNight: 280000,
        cancellationPolicy: { code: 'FLEXIBLE', name: 'Flexible' },
        averageRating: 4.9,
        status: 'ACTIVA',
      });
      for (const field of ['description', 'amenities', 'rules', 'images', 'additionalServices']) {
        expect(body[field]).toBeDefined();
      }
      expect(body.additionalServices.length).toBeGreaterThan(0);
    });

    it('15.2 (CA2) una publicación que no está ACTIVA responde 404 "no está disponible" al visitante y a otro huésped', async () => {
      const guest = await loginAs('curioso.hu026@stayhub.com', 'HUESPED');
      for (const token of [undefined, guest]) {
        const res = await detail('demo-bogota-pausada', token);
        expect(res.status).toBe(404);
        expect((await res.json()).message).toBe('Esta publicación no está disponible');
      }
      expect((await detail('no-existe')).status).toBe(404);
    });

    it('15.3 (CA2, AMB-39) el huésped con reserva, el anfitrión dueño y el admin sí la ven', async () => {
      const host = await loginAs('dueno.hu026@stayhub.com', 'ANFITRION');
      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${host}` },
        body: JSON.stringify({ title: 'Borrador del anfitrión' }),
      });
      const draftId = (await created.json()).id as string;
      expect((await detail(draftId)).status).toBe(404);
      expect((await detail(draftId, host)).status).toBe(200);

      const adminLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      expect((await detail('demo-bogota-pausada', (await adminLogin.json()).token)).status).toBe(200);

      const guest = await loginAs('conreserva.hu026@stayhub.com', 'HUESPED');
      const reserved = await fetch(`${baseUrl}/listings/demo-bogota-pausada/reserved-periods`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${guest}` },
        body: JSON.stringify({ checkIn: '2026-12-02', checkOut: '2026-12-04' }),
      });
      expect(reserved.status).toBe(201);
      expect((await detail('demo-bogota-pausada', guest)).status).toBe(200);
    });
  });

  describe('HU-022 · Consultar el calendario de disponibilidad (CA1, CA2, RF-028, RN-028)', () => {
    const json = { 'Content-Type': 'application/json' };
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return (await res.json()).token as string;
    };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const calendar = async (id: string, token?: string) => {
      const res = await fetch(`${baseUrl}/listings/${id}/calendar`, { headers: token ? auth(token) : {} });
      return { status: res.status, body: await res.json() };
    };
    const statusOn = (body: { months: Array<{ days: Array<{ date: string; status: string }> }> }, date: string) =>
      body.months.flatMap((m) => m.days).find((d) => d.date === date)?.status;

    it('16.1 (CA1, CA2) el público ve disponible/no disponible y el anfitrión distingue reservadas y bloqueadas', async () => {
      const host = await loginAs('calendario.hu022@stayhub.com', 'ANFITRION');
      const guest = await loginAs('huesped.hu022@stayhub.com', 'HUESPED');
      const adminLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      const admin = (await adminLogin.json()).token as string;

      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({
          title: 'Cabaña con calendario', description: 'Para HU-022.', city: 'Guatapé', department: 'Antioquia',
          address: 'Vereda El Roble', propertyType: 'CABANA', maxGuests: 2, pricePerNight: 200000,
          amenities: ['WIFI'], rules: ['No fumar'], images: ['https://storage.stayhub.com/c.jpg'],
        }),
      });
      const id = (await created.json()).id as string;
      await fetch(`${baseUrl}/listings/${id}/availability-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ startDate: day(10), endDate: day(40) }),
      });

      // Aún en BORRADOR: el público no ve su calendario; el anfitrión sí.
      expect((await calendar(id)).status).toBe(404);
      expect((await calendar(id, host)).body.view).toBe('ANFITRION');

      await fetch(`${baseUrl}/listings/${id}/request-activation`, { method: 'PATCH', headers: auth(host) });
      await fetch(`${baseUrl}/listings/${id}/approve`, { method: 'PATCH', headers: auth(admin) });

      await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(guest),
        body: JSON.stringify({ checkIn: day(15), checkOut: day(17) }),
      });
      await fetch(`${baseUrl}/listings/${id}/reserved-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ checkIn: day(20), checkOut: day(21), type: 'BLOQUEO' }),
      });

      const pub = await calendar(id);
      expect(pub.status).toBe(200);
      expect(pub.body.view).toBe('PUBLICA');
      expect(pub.body.months).toHaveLength(12);
      expect(statusOn(pub.body, day(12))).toBe('DISPONIBLE');
      expect(statusOn(pub.body, day(15))).toBe('NO_DISPONIBLE');
      expect(statusOn(pub.body, day(20))).toBe('NO_DISPONIBLE');
      expect(statusOn(pub.body, day(60))).toBe('NO_DISPONIBLE');

      const own = await calendar(id, host);
      expect(own.body.view).toBe('ANFITRION');
      expect(statusOn(own.body, day(12))).toBe('DISPONIBLE');
      expect(statusOn(own.body, day(15))).toBe('RESERVADA');
      expect(statusOn(own.body, day(16))).toBe('RESERVADA');
      expect(statusOn(own.body, day(17))).toBe('DISPONIBLE');
      expect(statusOn(own.body, day(20))).toBe('BLOQUEADA');
      expect(statusOn(own.body, day(60))).toBe('SIN_PERIODO');

      // Otro huésped ve la vista pública.
      expect((await calendar(id, guest)).body.view).toBe('PUBLICA');
    });
  });

  describe('HU-027 · Cotizar una estancia (CA1, CA2, CA3, CA4, RF-036 a RF-038)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const quote = (body: object) => fetch(`${baseUrl}/bookings/quote`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    let admin: string;

    beforeAll(async () => {
      admin = await login(
        process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
        process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
      );
      await fetch(`${baseUrl}/platform/service-fee`, { method: 'PATCH', headers: auth(admin), body: JSON.stringify({ serviceFeePercent: 10 }) });
    });

    afterAll(async () => {
      await fetch(`${baseUrl}/platform/service-fee`, { method: 'PATCH', headers: auth(admin), body: JSON.stringify({ serviceFeePercent: 12 }) });
    });

    it('17.1 (CA1, CA2, CA4) desglose de 3 y 7 noches con limpieza, descuento y tarifa del 10 %', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Anfitriona 27', email: 'cotiza.hu027@stayhub.com', password: 'Password123', role: 'ANFITRION' }),
      });
      const host = await login('cotiza.hu027@stayhub.com', 'Password123');
      const created = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ title: 'Apartamento de los criterios', city: 'Bogotá', pricePerNight: 200000 }),
      });
      const listingId = (await created.json()).id as string;
      await fetch(`${baseUrl}/listings/${listingId}/pricing`, {
        method: 'PATCH',
        headers: auth(host),
        body: JSON.stringify({ cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }),
      });
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await fetch(`${baseUrl}/listings/${listingId}/availability-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ startDate: day(1), endDate: day(90) }),
      });

      const three = await quote({ listingId, checkIn: day(30), checkOut: day(33), guests: 2 });
      expect(three.status).toBe(200);
      expect(await three.json()).toMatchObject({
        nights: 3,
        baseAmount: 600000,
        cleaningFee: 50000,
        discount: 0,
        serviceFee: 65000,
        totalAmount: 715000,
        currency: 'COP',
      });

      const seven = await (await quote({ listingId, checkIn: day(30), checkOut: day(37), guests: 2 })).json();
      expect(seven).toMatchObject({ baseAmount: 1400000, discount: 140000, serviceFee: 131000, totalAmount: 1441000 });
    });

    it('17.2 (CA3) un servicio adicional aparece como línea propia y entra en la base de la tarifa', async () => {
      // Apartamento en Chapinero Alto: 280.000 por noche, sin limpieza, traslado de 80.000.
      const res = await quote({
        listingId: 'demo-bogota-chapinero',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        guests: 2,
        additionalServices: ['Traslado desde el aeropuerto'],
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.additionalServices).toEqual([{ name: 'Traslado desde el aeropuerto', cost: 80000 }]);
      expect(body).toMatchObject({ baseAmount: 840000, subtotal: 920000, serviceFee: 92000, totalAmount: 1012000 });
    });

    it('17.3 rechaza fechas invertidas, adicionales inexistentes y publicaciones que no existen', async () => {
      expect((await quote({ listingId: 'demo-bogota-chapinero', checkIn: '2027-03-04', checkOut: '2027-03-01', guests: 2 })).status).toBe(400);
      expect(
        (await quote({ listingId: 'demo-bogota-chapinero', checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2, additionalServices: ['Spa'] }))
          .status,
      ).toBe(400);
      expect((await quote({ listingId: 'no-existe', checkIn: '2027-03-01', checkOut: '2027-03-04', guests: 2 })).status).toBe(404);
    });
  });

  describe('HU-028 · Validar la solicitud de cotización (CA1, CA2, CA3, RF-039)', () => {
    const json = { 'Content-Type': 'application/json' };
    const quote = async (body: object) => {
      const res = await fetch(`${baseUrl}/bookings/quote`, { method: 'POST', headers: json, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    // Apartamento en Chapinero Alto: capacidad 2, disponible del 2026-11-01 al 2026-12-20.
    const base = { listingId: 'demo-bogota-chapinero', checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2 };

    it('18.1 (CA1) salida igual o anterior a la llegada', async () => {
      const res = await quote({ ...base, checkOut: '2026-12-01' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ reason: 'FECHAS_INVALIDAS', message: 'La fecha de salida debe ser posterior a la fecha de llegada' });
    });

    it('18.2 (CA2) más huéspedes que la capacidad informa el máximo', async () => {
      const res = await quote({ ...base, guests: 3 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ reason: 'CAPACIDAD_EXCEDIDA', maxGuests: 2, message: 'Esta publicación admite máximo 2 huéspedes' });
    });

    it('18.3 (CA3) fechas no disponibles indican el periodo y las noches', async () => {
      const res = await quote({ ...base, checkIn: '2026-12-19', checkOut: '2026-12-22' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        reason: 'PERIODO_NO_DISPONIBLE',
        message: 'El periodo del 2026-12-19 al 2026-12-22 no está disponible en esta publicación',
        unavailableNights: ['2026-12-20', '2026-12-21'],
      });
      expect((await quote(base)).status).toBe(200);
    });
  });
  describe('HU-031 · Verificar la disponibilidad al confirmar (CA1, CA2, RF-042, RF-043, RNF-010)', () => {
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${guestBookingToken}` });
    const reserve = async (checkIn: string, checkOut: string, idempotencyKey: string) => {
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ listingId: 'demo-bogota-chapinero', checkIn, checkOut, guests: 2, idempotencyKey }),
      });
      expect(res.status).toBe(201);
      return res.json();
    };
    const pay = (bookingId: string) =>
      fetch(`${baseUrl}/bookings/${bookingId}/pay`, { method: 'POST', headers: headers(), body: JSON.stringify(card) });

    it('19.1 (CA2) dos pagos simultáneos sobre el mismo periodo: como máximo una reserva queda CONFIRMADA', async () => {
      const first = await reserve('2026-11-20', '2026-11-23', '31000000-0000-4000-8000-000000000001');
      const second = await reserve('2026-11-21', '2026-11-24', '31000000-0000-4000-8000-000000000002');

      const responses = await Promise.all([pay(first.id), pay(second.id)]);

      expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
      const confirmed = await Promise.all(
        [first.id, second.id].map(async (id) => (await (await fetch(`${baseUrl}/bookings/${id}`, { headers: headers() })).json()).status),
      );
      expect(confirmed.filter((status) => status === 'CONFIRMADA')).toHaveLength(1);
    });

    it('19.2 (CA1) el periodo tomado después de la cotización se rechaza sin cobro', async () => {
      const late = await reserve('2026-11-26', '2026-11-29', '31000000-0000-4000-8000-000000000003');
      const other = await reserve('2026-11-27', '2026-11-30', '31000000-0000-4000-8000-000000000004');
      expect((await pay(other.id)).status).toBe(200);

      const res = await pay(late.id);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toMatchObject({ reason: 'PERIODO_NO_DISPONIBLE', unavailableNights: ['2026-11-27', '2026-11-28'] });
      const detail = await (await fetch(`${baseUrl}/bookings/${late.id}`, { headers: headers() })).json();
      expect(detail.status).toBe('PENDIENTE');
      expect(detail.payment).toBeUndefined();
    });
  });
  describe('HU-032 · Evitar reservas duplicadas por reintentos (CA1, CA2, RF-044, RN-018)', () => {
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const reserve = (idempotencyKey: string, checkIn = '2026-12-10', checkOut = '2026-12-12') =>
      fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guestBookingToken}` },
        body: JSON.stringify({ listingId: 'demo-bogota-chapinero', checkIn, checkOut, guests: 2, idempotencyKey, card }),
      });

    it('20.1 (CA1) un doble clic y un reintento con la misma clave devuelven la misma reserva con un solo pago', async () => {
      const key = '32000000-0000-4000-8000-0000000000e1';
      const [first, second] = await Promise.all([reserve(key), reserve(key)]);
      const retry = await reserve(key);
      const bodies = await Promise.all([first.json(), second.json(), retry.json()]);

      expect([first.status, second.status, retry.status]).toEqual([201, 201, 201]);
      expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
      expect(new Set(bodies.map((body) => body.payment.reference)).size).toBe(1);
      expect(bodies[0]).toMatchObject({ status: 'CONFIRMADA', idempotencyKey: key });
    });

    it('20.2 (CA2) una clave nueva para otra estancia crea otra reserva', async () => {
      const res = await reserve('32000000-0000-4000-8000-0000000000e2', '2026-12-14', '2026-12-16');
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toMatchObject({ status: 'CONFIRMADA', checkIn: '2026-12-14' });
    });

    it('20.3 la misma clave para otra estancia responde 409', async () => {
      const res = await reserve('32000000-0000-4000-8000-0000000000e1', '2026-12-17', '2026-12-19');
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
    });
  });
  describe('HU-040 · Cancelar mi reserva (CA1, CA3, RF-053, RF-055, RF-056)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ name: email, email, password: 'Password123', role }) });
      return login(email, 'Password123');
    };
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    let listing40: string;
    let guestToken: string;
    let booking40: { id: string; totalAmount: number; serviceFee: number };

    beforeAll(async () => {
      const host = await registerAndLogin('anfitrion.hu040@stayhub.com', 'ANFITRION');
      const created = await (
        await fetch(`${baseUrl}/listings`, {
          method: 'POST',
          headers: auth(host),
          body: JSON.stringify({
            title: 'Cabaña para cancelar',
            description: 'HU-040',
            city: 'Guatapé',
            department: 'Antioquia',
            address: 'Vereda El Roble',
            propertyType: 'CABANA',
            maxGuests: 4,
            pricePerNight: 300000,
            amenities: ['WIFI'],
            rules: ['No fumar'],
            images: ['https://storage.stayhub.com/cabana-40.jpg'],
          }),
        })
      ).json();
      listing40 = created.id;
      await fetch(`${baseUrl}/listings/${listing40}/availability-periods`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ startDate: day(1), endDate: day(90) }),
      });
      await fetch(`${baseUrl}/listings/${listing40}/request-activation`, { method: 'PATCH', headers: auth(host) });
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      await fetch(`${baseUrl}/listings/${listing40}/approve`, { method: 'PATCH', headers: auth(admin) });

      guestToken = await registerAndLogin('huesped.hu040@stayhub.com', 'HUESPED');
      const res = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: auth(guestToken),
        body: JSON.stringify({ listingId: listing40, checkIn: day(20), checkOut: day(23), guests: 2, idempotencyKey: '40000000-0000-4000-8000-0000000000e1', card }),
      });
      booking40 = await res.json();
    });

    const cancel = (token: string, body: object) =>
      fetch(`${baseUrl}/bookings/${booking40.id}/cancel`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(body) });

    it('21.1 Mis reservas lista la reserva CONFIRMADA del huésped con su publicación', async () => {
      const mine = await (await fetch(`${baseUrl}/bookings/my`, { headers: auth(guestToken) })).json();
      expect(mine).toEqual([
        expect.objectContaining({ id: booking40.id, status: 'CONFIRMADA', listingTitle: 'Cabaña para cancelar', cancellationPolicyName: 'Flexible' }),
      ]);
    });

    it('21.2 otro huésped no la cancela y sin motivo se rechaza', async () => {
      const other = await registerAndLogin('otro.hu040@stayhub.com', 'HUESPED');
      expect((await cancel(other, { reason: 'No es mía' })).status).toBe(403);
      expect((await cancel(guestToken, { reason: '   ' })).status).toBe(400);
    });

    it('21.3 (CA1, CA3) la reserva pasa a CANCELADA, registra la cancelación y el periodo vuelve a estar disponible', async () => {
      const res = await cancel(guestToken, { reason: 'Cambio imprevisto de itinerario' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('CANCELADA');
      expect(body.cancellation).toMatchObject({
        cancelledBy: 'huesped.hu040@stayhub.com',
        reason: 'Cambio imprevisto de itinerario',
        policy: 'FLEXIBLE',
        refundPercentage: 100,
        refundAmount: booking40.totalAmount - booking40.serviceFee,
        finalStatus: 'CANCELADA',
        releasedNights: [day(20), day(21), day(22)],
      });
      expect(Number.isNaN(Date.parse(body.cancellation.cancelledAt))).toBe(false);

      const quote = await fetch(`${baseUrl}/bookings/quote`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ listingId: listing40, checkIn: day(20), checkOut: day(23), guests: 2 }),
      });
      expect(quote.status).toBe(200);
    });

    it('21.4 (CA3) la cancelación queda en la auditoría y no se puede repetir', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const events = await (await fetch(`${baseUrl}/audit/events?action=BOOKING_CANCELLATION&limit=100`, { headers: auth(admin) })).json();
      const items = events.data;
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityId: booking40.id, result: 'EXITOSO', actor: 'huesped.hu040@stayhub.com' }),
        ]),
      );
      const again = await cancel(guestToken, { reason: 'Otra vez' });
      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ reason: 'ESTADO_NO_CANCELABLE' });
    });
  });
  describe('HU-033 · Consultar el estado de mis reservas (CA1, CA2, RF-047)', () => {
    const json = { 'Content-Type': 'application/json' };
    const detail = (token: string, id = bookingId) => fetch(`${baseUrl}/bookings/${id}`, { headers: { Authorization: `Bearer ${token}` } });

    it('22.1 (CA1) el huésped ve alojamiento, fechas, huéspedes, desglose, política y estado de su reserva', async () => {
      const res = await detail(guestBookingToken);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        id: bookingId,
        status: 'PENDIENTE',
        listingTitle: expect.any(String),
        listingCity: 'Bogotá',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        guests: 2,
        nights: 3,
        baseAmount: expect.any(Number),
        serviceFee: expect.any(Number),
        totalAmount: expect.any(Number),
        cancellationPolicyName: 'Flexible',
        cancellationPolicyDescription: expect.stringContaining('48 horas'),
      });
    });

    it('22.2 (CA2) otro huésped recibe 403 y una reserva inexistente 404', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Otro', email: 'otro.hu033@stayhub.com', password: 'Password123', role: 'HUESPED' }),
      });
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: 'otro.hu033@stayhub.com', password: 'Password123' }),
      });
      const other = (await login.json()).token;

      expect((await detail(other)).status).toBe(403);
      expect((await detail(guestBookingToken, 'no-existe')).status).toBe(404);
    });
  });
  describe('HU-043 · Recibir notificaciones de los eventos (CA1, CA2, CA3, RF-059)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const registerAndLogin = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ name: email, email, password: 'Password123', role }) });
      return login(email, 'Password123');
    };
    const notificationsOf = async (token: string) => (await fetch(`${baseUrl}/notifications`, { headers: auth(token) })).json();
    let host: string;
    let guest: string;
    let booking: { id: string; code: string };

    beforeAll(async () => {
      host = await registerAndLogin('anfitrion.hu043@stayhub.com', 'ANFITRION');
      const listing = await (
        await fetch(`${baseUrl}/listings`, {
          method: 'POST',
          headers: auth(host),
          body: JSON.stringify({
            title: 'Cabaña con avisos',
            description: 'HU-043',
            city: 'Guatapé',
            department: 'Antioquia',
            address: 'Vereda El Roble',
            propertyType: 'CABANA',
            maxGuests: 4,
            pricePerNight: 300000,
            amenities: ['WIFI'],
            rules: ['No fumar'],
            images: ['https://storage.stayhub.com/cabana-43.jpg'],
          }),
        })
      ).json();
      await fetch(`${baseUrl}/listings/${listing.id}/availability-periods`, { method: 'POST', headers: auth(host), body: JSON.stringify({ startDate: day(1), endDate: day(90) }) });
      await fetch(`${baseUrl}/listings/${listing.id}/request-activation`, { method: 'PATCH', headers: auth(host) });
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      await fetch(`${baseUrl}/listings/${listing.id}/approve`, { method: 'PATCH', headers: auth(admin) });

      guest = await registerAndLogin('huesped.hu043@stayhub.com', 'HUESPED');
      booking = await (
        await fetch(`${baseUrl}/bookings/instant`, {
          method: 'POST',
          headers: auth(guest),
          body: JSON.stringify({
            listingId: listing.id,
            checkIn: day(30),
            checkOut: day(32),
            guests: 2,
            idempotencyKey: '43000000-0000-4000-8000-0000000000e1',
            card: { cardNumber: '4242424242424242', cardHolder: 'Huésped', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' },
          }),
        })
      ).json();
    });

    it('23.1 (CA1) huésped y anfitrión reciben la confirmación con el código de la reserva', async () => {
      const toGuest = await notificationsOf(guest);
      const toHost = await notificationsOf(host);

      expect(toGuest.data[0]).toMatchObject({ type: 'RESERVA_CONFIRMADA', bookingCode: booking.code, entityId: booking.id, read: false });
      expect(toHost.data[0]).toMatchObject({ type: 'RESERVA_CONFIRMADA', bookingCode: booking.code });
      expect(toGuest.data[0].message).toContain(booking.code);
    });

    it('23.2 (CA2) el anfitrión recibió la aprobación de su publicación', async () => {
      const toHost = await notificationsOf(host);
      expect(toHost.data.map((n: { type: string }) => n.type)).toContain('PUBLICACION_APROBADA');
      expect(toHost.unread).toBe(2);
    });

    it('23.3 (CA3) marcar como leída cambia el estado; otro usuario no la ve ni la marca', async () => {
      const [notification] = (await notificationsOf(guest)).data;
      const other = await registerAndLogin('otro.hu043@stayhub.com', 'HUESPED');

      expect((await notificationsOf(other)).data).toEqual([]);
      expect((await fetch(`${baseUrl}/notifications/${notification.id}/read`, { method: 'PATCH', headers: auth(other) })).status).toBe(404);

      const res = await fetch(`${baseUrl}/notifications/${notification.id}/read`, { method: 'PATCH', headers: auth(guest) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ read: true, readAt: expect.any(String) });
      expect((await notificationsOf(guest)).unread).toBe(0);
      expect((await fetch(`${baseUrl}/notifications`)).status).toBe(401);
    });
  });

  describe('HU-046 · Completar estancias automáticamente (CA1, CA2, RF-062)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('24.1 el administrador ejecuta el cierre diario; solo completa salidas pasadas y no toca reservas futuras', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const res = await fetch(`${baseUrl}/bookings/daily-closure`, { method: 'POST', headers: auth(admin) });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), completed: expect.any(Number) });
      expect(body.bookingIds).toHaveLength(body.completed);

      const guest = await login('huesped.hu043@stayhub.com', 'Password123');
      const mine = await (await fetch(`${baseUrl}/bookings/my`, { headers: auth(guest) })).json();
      const items = Array.isArray(mine) ? mine : mine.data;
      expect(items.every((item: { status: string }) => item.status === 'CONFIRMADA')).toBe(true);
    });

    it('24.2 un huésped no puede ejecutar el cierre y sin sesión responde 401', async () => {
      const guest = await login('huesped.hu043@stayhub.com', 'Password123');
      expect((await fetch(`${baseUrl}/bookings/daily-closure`, { method: 'POST', headers: auth(guest) })).status).toBe(403);
      expect((await fetch(`${baseUrl}/bookings/daily-closure`, { method: 'POST' })).status).toBe(401);
    });
  });

  describe('HU-047 · Calificar y reseñar mi estancia (CA2, RF-063)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const sendReview = (token: string | null, body: unknown) =>
      fetch(`${baseUrl}/reviews`, { method: 'POST', headers: token ? auth(token) : json, body: JSON.stringify(body) });
    let guest: string;
    let bookingId: string;

    beforeAll(async () => {
      guest = await login('huesped.hu043@stayhub.com', 'Password123');
      const mine = await (await fetch(`${baseUrl}/bookings/my`, { headers: auth(guest) })).json();
      bookingId = (Array.isArray(mine) ? mine : mine.data)[0].id;
    });

    it('25.1 (CA2) una reserva CONFIRMADA todavía no se puede reseñar', async () => {
      const res = await sendReview(guest, { bookingId, rating: 5, comment: 'Excelente estancia' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ reason: 'RESERVA_NO_COMPLETADA' });
    });

    it('25.2 (CA2) otro huésped no puede reseñar la reserva y sin sesión responde 401', async () => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Otro', email: 'otro.hu047@stayhub.com', password: 'Password123', role: 'HUESPED' }),
      });
      const other = await login('otro.hu047@stayhub.com', 'Password123');
      const res = await sendReview(other, { bookingId, rating: 5, comment: 'No es mía' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ reason: 'RESERVA_AJENA' });
      expect((await sendReview(null, { bookingId, rating: 5, comment: 'Sin sesión' })).status).toBe(401);
    });

    it('25.3 la calificación debe ser de 1 a 5 y el comentario es obligatorio', async () => {
      expect((await sendReview(guest, { bookingId, rating: 6, comment: 'Muy bien' })).status).toBe(400);
      expect((await sendReview(guest, { bookingId, rating: 4, comment: '' })).status).toBe(400);
      expect((await sendReview(guest, { bookingId: 'no-existe', rating: 4, comment: 'Muy bien' })).status).toBe(404);
    });
  });

  describe('26 HU-048 (RF-065, RN-025): Consultar reseñas y calificación', () => {
    it('26.1 (CA1) consulta reseñas ordenadas de la más reciente a la más antigua y promedio', async () => {
      const res = await fetch(`${baseUrl}/listings/demo-bogota-chapinero/reviews`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.listingId).toBe('demo-bogota-chapinero');
      expect(body.totalReviews).toBeGreaterThanOrEqual(1);
      expect(body.reviews.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < body.reviews.length; i++) {
        const prev = new Date(body.reviews[i - 1].createdAt).getTime();
        const curr = new Date(body.reviews[i].createdAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('26.2 (CA2) publicación sin reseñas responde con total 0 y reseñas vacías', async () => {
      const res = await fetch(`${baseUrl}/listings/demo-bogota-chico/reviews`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalReviews).toBe(0);
      expect(body.reviews).toEqual([]);
    });
  });

  describe('HU-049 · Ocultar reseñas que incumplen las reglas (CA1, CA2 · RF-066, RN-021, RN-025)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('26.3 (CA1, CA2) el administrador oculta una reseña indicando motivo; deja de mostrarse públicamente y se audita', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const guest = await login('huesped.hu043@stayhub.com', 'Password123');

      const listRes = await fetch(`${baseUrl}/listings/demo-bogota-chapinero/reviews`);
      const listData = await listRes.json();
      const reviewToHide = listData.reviews?.[0];
      expect(reviewToHide).toBeDefined();

      const forbiddenRes = await fetch(`${baseUrl}/reviews/${reviewToHide.id}/hide`, {
        method: 'PATCH',
        headers: auth(guest),
        body: JSON.stringify({ reason: 'Intento de huésped' }),
      });
      expect(forbiddenRes.status).toBe(403);

      const hideRes = await fetch(`${baseUrl}/reviews/${reviewToHide.id}/hide`, {
        method: 'PATCH',
        headers: auth(admin),
        body: JSON.stringify({ reason: 'Contenido inapropiado que infringe normas de moderación' }),
      });
      expect(hideRes.status).toBe(200);
      const hiddenBody = await hideRes.json();
      expect(hiddenBody.visible).toBe(false);

      const afterRes = await fetch(`${baseUrl}/listings/demo-bogota-chapinero/reviews`);
      const afterData = await afterRes.json();
      expect(afterData.reviews.some((r: any) => r.id === reviewToHide.id)).toBe(false);

      const auditRes = await fetch(`${baseUrl}/audit/events?action=REVIEW_MODERATED`, { headers: auth(admin) });
      expect(auditRes.status).toBe(200);
      const auditData = await auditRes.json();
      const auditEvents = Array.isArray(auditData) ? auditData : (auditData.data ?? []);
      const foundEvent = auditEvents.find((e: any) => e.entityId === reviewToHide.id);
      expect(foundEvent).toBeDefined();
      expect(foundEvent.actor).toBe(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com');
      expect(foundEvent.detail).toContain('Contenido inapropiado');
    });

    it('26.4 validaciones: motivo vacío responde 400 y reseña inexistente responde 404', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const badRes = await fetch(`${baseUrl}/reviews/inexistente/hide`, {
        method: 'PATCH',
        headers: auth(admin),
        body: JSON.stringify({ reason: '' }),
      });
      expect(badRes.status).toBe(400);

      const notFoundRes = await fetch(`${baseUrl}/reviews/review-inexistente/hide`, {
        method: 'PATCH',
        headers: auth(admin),
        body: JSON.stringify({ reason: 'Motivo válido de prueba' }),
      });
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('HU-051 · Bloquear una publicación engañosa (CA1, CA2, CA3, CA4, RF-067, RF-068)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const block = (token: string | null, id: string, body: unknown) =>
      fetch(`${baseUrl}/listings/${id}/block`, { method: 'PATCH', headers: token ? auth(token) : json, body: JSON.stringify(body) });
    const reason = 'Las fotografías no corresponden al inmueble';
    let admin: string;
    let guest: string;
    let host: string;
    let booking: { id: string; code: string; listingId: string };

    beforeAll(async () => {
      admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      guest = await login('huesped.hu043@stayhub.com', 'Password123');
      host = await login('anfitrion.hu043@stayhub.com', 'Password123');
      const mine = await (await fetch(`${baseUrl}/bookings/my`, { headers: auth(guest) })).json();
      booking = (Array.isArray(mine) ? mine : mine.data)[0];
    });

    it('27.1 solo el administrador bloquea, con motivo, y sin sesión responde 401', async () => {
      expect((await block(guest, booking.listingId, { reason })).status).toBe(403);
      expect((await block(host, booking.listingId, { reason })).status).toBe(403);
      expect((await block(null, booking.listingId, { reason })).status).toBe(401);
      expect((await block(admin, booking.listingId, { reason: '' })).status).toBe(400);
      expect((await block(admin, 'no-existe', { reason })).status).toBe(404);
    });

    it('27.2 (CA1, CA2, CA3) la publicación pasa a BLOQUEADA, sale de las búsquedas y su reserva futura pasa a EN_REVISION', async () => {
      const res = await block(admin, booking.listingId, { reason });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'BLOQUEADA', previousStatus: 'ACTIVA', blockReason: reason, bookingsUnderReview: [booking.code] });

      const search = await (await fetch(`${baseUrl}/listings/search?city=Guatap%C3%A9`)).json();
      expect(search.data.map((item: { id: string }) => item.id)).not.toContain(booking.listingId);

      const stored = await (await fetch(`${baseUrl}/bookings/${booking.id}`, { headers: auth(guest) })).json();
      expect(stored).toMatchObject({ status: 'EN_REVISION', reviewReason: expect.stringContaining(reason) });

      const toGuest = (await (await fetch(`${baseUrl}/notifications`, { headers: auth(guest) })).json()).data;
      expect(toGuest[0]).toMatchObject({ type: 'RESERVA_EN_REVISION', bookingCode: booking.code });
      const toHost = (await (await fetch(`${baseUrl}/notifications`, { headers: auth(host) })).json()).data;
      expect(toHost[0]).toMatchObject({ type: 'PUBLICACION_BLOQUEADA' });

      const events = await (await fetch(`${baseUrl}/audit/events?action=LISTING_STATUS_CHANGE&limit=100`, { headers: auth(admin) })).json();
      const items = events.data;
      expect(items.some((event: { entityId: string; detail: string }) => event.entityId === booking.listingId && event.detail.includes('ACTIVA -> BLOQUEADA'))).toBe(true);

      expect((await block(admin, booking.listingId, { reason })).status).toBe(400);
    });

    it('27.3 (CA4) el anfitrión solicita una nueva revisión y la publicación vuelve a PENDIENTE_REVISION', async () => {
      const res = await fetch(`${baseUrl}/listings/${booking.listingId}/request-activation`, { method: 'PATCH', headers: auth(host) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'PENDIENTE_REVISION' });

      const pending = await (await fetch(`${baseUrl}/listings/pending`, { headers: auth(admin) })).json();
      expect(pending.map((item: { id: string }) => item.id)).toContain(booking.listingId);
      const all = await (await fetch(`${baseUrl}/listings/admin/all`, { headers: auth(admin) })).json();
      expect(all.find((item: { id: string }) => item.id === booking.listingId)).toMatchObject({ status: 'PENDIENTE_REVISION' });
    });
  });

  describe('HU-056 · Ver los indicadores del negocio (CA1, CA3, RF-074)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('28.1 (CA1) el administrador ve usuarios por rol, publicaciones ACTIVAS, reservas por estado, ingresos y ciudades', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const res = await fetch(`${baseUrl}/reports/dashboard`, { headers: auth(admin) });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.usersByRole).toEqual({
        HUESPED: expect.any(Number),
        ANFITRION: expect.any(Number),
        ADMINISTRADOR: expect.any(Number),
        total: body.usersByRole.HUESPED + body.usersByRole.ANFITRION + body.usersByRole.ADMINISTRADOR,
      });
      expect(body.usersByRole.ADMINISTRADOR).toBeGreaterThanOrEqual(1);
      expect(body.activeListings).toBeGreaterThan(0);
      const { total, ...byStatus } = body.bookingsByStatus;
      expect(Object.keys(byStatus).sort()).toEqual(['CANCELADA', 'COMPLETADA', 'CONFIRMADA', 'EN_REVISION', 'PENDIENTE']);
      expect(total).toBe(Object.values(byStatus).reduce((sum: number, n) => sum + Number(n), 0));
      expect(body.estimatedRevenue).toMatchObject({ currency: 'COP', grossBookingValue: expect.any(Number), platformFees: expect.any(Number) });
      expect(body.topCities.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < body.topCities.length; i++) {
        expect(body.topCities[i - 1].bookings).toBeGreaterThanOrEqual(body.topCities[i].bookings);
      }
    });

    it('28.2 (CA3) el huésped y el anfitrión reciben 403 y sin sesión 401', async () => {
      const guest = await login('huesped.hu043@stayhub.com', 'Password123');
      const host = await login('anfitrion.hu043@stayhub.com', 'Password123');
      expect((await fetch(`${baseUrl}/reports/dashboard`, { headers: auth(guest) })).status).toBe(403);
      expect((await fetch(`${baseUrl}/reports/dashboard`, { headers: auth(host) })).status).toBe(403);
      expect((await fetch(`${baseUrl}/reports/dashboard`)).status).toBe(401);
    });
  });

  describe('29 HU-053 (RF-070, RF-071, RN-020, RN-021): Restringir a un usuario', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('29.1 (CA1, CA2) administrador restringe a un usuario, invalida sus sesiones y pasa publicaciones activas a PAUSADA', async () => {
      const adminToken = await login('admin@inversioneslr.com', 'AdminLr2026!');
      const userEmail = 'test.restringir@stayhub.com';
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Usuario Restringible', email: userEmail, password: 'Password123!', role: 'ANFITRION' }),
      });
      const userToken = await login(userEmail, 'Password123!');
      expect(userToken).toBeDefined();

      const res = await fetch(`${baseUrl}/users/${userEmail}/restrict`, {
        method: 'PATCH',
        headers: auth(adminToken),
        body: JSON.stringify({ reason: 'Comportamiento sospechoso de anfitrión' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('RESTRINGIDA');

      // Sesión invalidada
      const meRes = await fetch(`${baseUrl}/users/me`, { headers: auth(userToken) });
      expect(meRes.status).toBe(401);

      // Login denegado
      const loginDenied = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: userEmail, password: 'Password123!' }),
      });
      expect(loginDenied.status).toBe(403);
    });

    it('29.2 (CA3) levantar restricción permite iniciar sesión nuevamente', async () => {
      const adminToken = await login('admin@inversioneslr.com', 'AdminLr2026!');
      const userEmail = 'test.restringir@stayhub.com';
      const unrestrictRes = await fetch(`${baseUrl}/users/${userEmail}/unrestrict`, {
        method: 'PATCH',
        headers: auth(adminToken),
      });
      expect(unrestrictRes.status).toBe(200);
      expect((await unrestrictRes.json()).status).toBe('ACTIVA');

      const loginOk = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: userEmail, password: 'Password123!' }),
      });
      expect(loginOk.status).toBe(200);
    });
  });

  describe('HU-025 · Filtrar por tipo, precio y servicios (CA1, CA2, CA3, RF-032)', () => {
    const search = async (query: string) => {
      const res = await fetch(`${baseUrl}/listings/search?limit=100&${query}`);
      return { status: res.status, body: await res.json() };
    };

    it('30.1 (CA1) tipo APARTAMENTO entre 150.000 y 300.000 COP: solo apartamentos en ese rango', async () => {
      const { status, body } = await search('propertyType=APARTAMENTO&minPrice=150000&maxPrice=300000');
      expect(status).toBe(200);
      for (const item of body.data) {
        expect(item.propertyType).toBe('APARTAMENTO');
        expect(item.pricePerNight).toBeGreaterThanOrEqual(150000);
        expect(item.pricePerNight).toBeLessThanOrEqual(300000);
      }
    });

    it('30.2 (CA2) WIFI y PARQUEADERO, separados por coma o repetidos: todas las publicaciones tienen ambos', async () => {
      const synonyms: Record<string, string> = { PARKING: 'PARQUEADERO' };
      const byComma = await search('amenities=WIFI,PARQUEADERO');
      const repeated = await search('amenities=WIFI&amenities=PARQUEADERO');
      expect(byComma.status).toBe(200);
      expect(byComma.body.data.length).toBeGreaterThan(0);
      expect(repeated.body.total).toBe(byComma.body.total);
      for (const item of byComma.body.data) {
        const codes = item.amenities.map((code: string) => synonyms[code] ?? code);
        expect(codes).toEqual(expect.arrayContaining(['WIFI', 'PARQUEADERO']));
      }
    });

    it('30.3 (CA3) sin resultados responde 200 vacío; parámetros inválidos responden 400', async () => {
      const empty = await search('propertyType=FINCA&minPrice=99000000');
      expect(empty).toMatchObject({ status: 200, body: { data: [], total: 0 } });
      expect((await search('propertyType=CASTILLO')).status).toBe(400);
      expect((await search('minPrice=300000&maxPrice=150000')).status).toBe(400);
    });
  });

  describe('HU-058 · Exportar reportes a Excel (CA1, RF-076, RF-077)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('31.1 (CA1) el administrador descarga cada reporte como .xlsx', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      for (const report of ['usuarios', 'publicaciones', 'reservas', 'ingresos', 'demanda']) {
        const res = await fetch(`${baseUrl}/reports/export/${report}?from=2026-01-01&city=Guatap%C3%A9`, { headers: auth(admin) });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(res.headers.get('content-disposition')).toMatch(new RegExp(`attachment; filename="stayhub-${report}-.*\.xlsx"`));
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.subarray(0, 2).toString()).toBe('PK');
      }
    });

    it('31.2 solo el administrador exporta; reporte desconocido 404 y filtros inválidos 400', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const guest = await login('huesped.hu043@stayhub.com', 'Password123');
      expect((await fetch(`${baseUrl}/reports/export/reservas`, { headers: auth(guest) })).status).toBe(403);
      expect((await fetch(`${baseUrl}/reports/export/reservas`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/reports/export/secretos`, { headers: auth(admin) })).status).toBe(404);
      expect((await fetch(`${baseUrl}/reports/export/reservas?from=ayer`, { headers: auth(admin) })).status).toBe(400);
      expect((await fetch(`${baseUrl}/reports/export/reservas?from=2026-10-31&to=2026-10-01`, { headers: auth(admin) })).status).toBe(400);
    });
  });
  describe('HU-059 · Exportar reportes a PDF (CA1, CA2, RF-076, RF-077, RN-026)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('32.1 (CA1, CA2) el administrador descarga cada reporte como .pdf con encabezado %PDF-', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      for (const report of ['usuarios', 'publicaciones', 'reservas', 'ingresos', 'demanda']) {
        const res = await fetch(`${baseUrl}/reports/export/${report}/pdf?from=2026-01-01&city=Guatap%C3%A9`, { headers: auth(admin) });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/pdf');
        expect(res.headers.get('content-disposition')).toMatch(new RegExp(`attachment; filename="stayhub-${report}-.*\.pdf"`));
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      }
    });

    it('32.2 solo el administrador exporta a PDF; reporte desconocido 404 y filtros inválidos 400', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const guest = await login('huesped.hu043@stayhub.com', 'Password123');
      expect((await fetch(`${baseUrl}/reports/export/reservas/pdf`, { headers: auth(guest) })).status).toBe(403);
      expect((await fetch(`${baseUrl}/reports/export/reservas/pdf`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/reports/export/secretos/pdf`, { headers: auth(admin) })).status).toBe(404);
      expect((await fetch(`${baseUrl}/reports/export/reservas/pdf?from=ayer`, { headers: auth(admin) })).status).toBe(400);
      expect((await fetch(`${baseUrl}/reports/export/reservas/pdf?from=2026-10-31&to=2026-10-01`, { headers: auth(admin) })).status).toBe(400);
    });
  });

  describe('HU-060 · Registrar las exportaciones (CA1, CA2 · RF-078, RN-027)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;

    it('33.1 (CA1, CA2) cada exportación se registra en auditoría y se consulta como evento de exportación', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const xlsxRes = await fetch(`${baseUrl}/reports/export/reservas?from=2026-01-01&status=CONFIRMADA`, { headers: auth(admin) });
      expect(xlsxRes.status).toBe(200);

      const pdfRes = await fetch(`${baseUrl}/reports/export/usuarios/pdf`, { headers: auth(admin) });
      expect(pdfRes.status).toBe(200);

      const auditRes = await fetch(`${baseUrl}/audit/events?action=EXPORT`, { headers: auth(admin) });
      expect(auditRes.status).toBe(200);
      const auditPayload = (await auditRes.json()) as any;
      const events = (Array.isArray(auditPayload) ? auditPayload : auditPayload.data) as Array<{
        actor: string;
        action: string;
        entity: string;
        entityId: string;
        occurredAt: string;
        detail: string;
        metadata?: { report: string; format: string; filters: Record<string, unknown> };
      }>;

      expect(events.length).toBeGreaterThanOrEqual(2);
      const lastXlsx = events.find((e) => e.entityId === 'reservas' && e.detail.includes('Excel'));
      expect(lastXlsx).toBeDefined();
      expect(lastXlsx?.actor).toBe(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com');
      expect(lastXlsx?.action).toBe('EXPORT');
      expect(lastXlsx?.entity).toBe('Report');
      expect(lastXlsx?.detail).toContain('desde 2026-01-01');
      expect(lastXlsx?.detail).toContain('estado CONFIRMADA');
      expect(Number.isNaN(Date.parse(lastXlsx!.occurredAt))).toBe(false);

      const lastPdf = events.find((e) => e.entityId === 'usuarios' && e.detail.includes('PDF'));
      expect(lastPdf).toBeDefined();
      expect(lastPdf?.actor).toBe(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com');
      expect(lastPdf?.action).toBe('EXPORT');
      expect(lastPdf?.entity).toBe('Report');
      expect(lastPdf?.detail).toContain('PDF');
      expect(Number.isNaN(Date.parse(lastPdf!.occurredAt))).toBe(false);
    });
  });

  describe('RF-041 · Solo una cuenta de huésped reserva (RN-002)', () => {
    const json = { 'Content-Type': 'application/json' };
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const reserve = (token: string) =>
      fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listingId: 'demo-bogota-chapinero', checkIn: '2026-11-24', checkOut: '2026-11-26', guests: 1, idempotencyKey: randomUUID() }),
      });

    it('33.1 el anfitrión y el administrador reciben 403 al reservar, pagar o confirmar; la cotización sigue abierta', async () => {
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      for (const token of [authToken, admin]) {
        expect((await reserve(token)).status).toBe(403);
        const auth = { ...json, Authorization: `Bearer ${token}` };
        expect((await fetch(`${baseUrl}/bookings/${bookingId}/pay`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(403);
        expect((await fetch(`${baseUrl}/bookings/${bookingId}/confirm`, { method: 'PATCH', headers: auth })).status).toBe(403);
      }
      const quote = await fetch(`${baseUrl}/bookings/quote`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ listingId: 'demo-bogota-chapinero', checkIn: '2026-11-24', checkOut: '2026-11-26', guests: 1 }),
      });
      expect(quote.status).toBe(200);
    });

    it('33.2 el huésped sí puede reservar', async () => {
      expect((await reserve(guestBookingToken)).status).toBe(201);
    });
  });

  describe('HU-054 · Consultar los eventos de auditoría (CA1, CA2, RF-072, RN-032, RNF-022)', () => {
    type AuditRow = { id: string; actor: string; action: string; entity: string; occurredAt: string; result: string };
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    let admin: string;
    const actor = `auditoria.${randomUUID()}@prueba.com`;
    const query = async (params: string) => {
      const res = await fetch(`${baseUrl}/audit/events?${params}`, { headers: auth(admin) });
      return { status: res.status, body: await res.json() };
    };

    beforeAll(async () => {
      admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ email: actor, password: 'ClaveIncorrecta1' }),
        });
      }
    });

    it('34.1 (CA1) devuelve una página con los eventos completos, del más reciente al más antiguo', async () => {
      const { status, body } = await query('limit=5');

      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, limit: 5, total: expect.any(Number), totalPages: expect.any(Number) });
      expect(body.data.length).toBeLessThanOrEqual(5);
      const times = body.data.map((event: AuditRow) => Date.parse(event.occurredAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      body.data.forEach((event: AuditRow) =>
        expect(event).toEqual(
          expect.objectContaining({ actor: expect.any(String), action: expect.any(String), entity: expect.any(String), result: expect.any(String) }),
        ),
      );
    });

    it('34.2 (CA1) la segunda página continúa donde terminó la primera', async () => {
      const first = (await query(`actor=${actor}&limit=2&page=1`)).body;
      const second = (await query(`actor=${actor}&limit=2&page=2`)).body;

      expect(first).toMatchObject({ total: 3, totalPages: 2 });
      expect(second.data).toHaveLength(1);
      expect(second.data[0].id).not.toBe(first.data[0].id);
      expect(Date.parse(second.data[0].occurredAt)).toBeLessThanOrEqual(Date.parse(first.data[1].occurredAt));
    });

    it('34.3 (CA2) solo devuelve los eventos que cumplen todos los filtros', async () => {
      const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
      const { body } = await query(`actor=${actor}&action=LOGIN&entity=AuthSession&result=FALLIDO&from=${today}&to=${today}`);

      expect(body.total).toBe(3);
      body.data.forEach((event: AuditRow) => expect(event).toMatchObject({ actor, action: 'LOGIN', entity: 'AuthSession', result: 'FALLIDO' }));
      expect((await query(`actor=${actor}&entity=Booking`)).body.total).toBe(0);
      expect((await query(`actor=${actor}&to=2020-01-01`)).body.total).toBe(0);
    });

    it('34.4 (CA2) rechaza filtros de fecha no válidos', async () => {
      expect((await query('from=2026-10-20&to=2026-10-01')).status).toBe(400);
      expect((await query('from=ayer')).status).toBe(400);
      expect((await query('limit=0')).status).toBe(400);
    });

    it('34.5 solo el administrador consulta la auditoría', async () => {
      expect((await fetch(`${baseUrl}/audit/events`, { headers: auth(guestBookingToken) })).status).toBe(403);
    });
  });

  describe('HU-052 · Resolver las reservas en revisión (CA1, CA2, RF-071, RN-017, RN-020)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const listing = 'demo-bogota-usaquen';
    const resolve = (token: string, id: string, body: unknown) =>
      fetch(`${baseUrl}/bookings/${id}/resolve-review`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(body) });
    const book = async (checkIn: string, checkOut: string) => {
      const created = await (
        await fetch(`${baseUrl}/bookings/instant`, {
          method: 'POST',
          headers: auth(guestBookingToken),
          body: JSON.stringify({ listingId: listing, checkIn, checkOut, guests: 1, idempotencyKey: randomUUID() }),
        })
      ).json();
      const paid = await fetch(`${baseUrl}/bookings/${created.id}/pay`, { method: 'POST', headers: auth(guestBookingToken), body: JSON.stringify(card) });
      expect(paid.status).toBe(200);
      return created as { id: string; code?: string };
    };
    const nights = async () =>
      (await (await fetch(`${baseUrl}/listings/${listing}/reserved-periods`)).json()) as Array<{ bookingId?: string; blockedNights: string[] }>;
    let admin: string;
    let kept: { id: string };
    let cancelled: { id: string };

    beforeAll(async () => {
      admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      kept = await book('2026-12-14', '2026-12-16');
      cancelled = await book('2026-12-18', '2026-12-21');
      const blocked = await fetch(`${baseUrl}/listings/${listing}/block`, {
        method: 'PATCH',
        headers: auth(admin),
        body: JSON.stringify({ reason: 'La habitación no corresponde a las fotografías' }),
      });
      expect(blocked.status).toBe(200);
    });

    it('35.1 el administrador ve las reservas en revisión; otros roles reciben 403', async () => {
      const res = await fetch(`${baseUrl}/bookings/under-review`, { headers: auth(admin) });
      expect(res.status).toBe(200);
      const ids = (await res.json()).map((item: { id: string }) => item.id);
      expect(ids).toEqual(expect.arrayContaining([kept.id, cancelled.id]));
      expect((await fetch(`${baseUrl}/bookings/under-review`, { headers: auth(guestBookingToken) })).status).toBe(403);
      expect((await resolve(guestBookingToken, kept.id, { decision: 'MANTENER' })).status).toBe(403);
    });

    it('35.2 (CA1) mantener: vuelve a CONFIRMADA, conserva sus noches y se notifica al huésped', async () => {
      const res = await resolve(admin, kept.id, { decision: 'MANTENER', note: 'Revisado con el anfitrión' });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'CONFIRMADA', reviewResolution: { decision: 'MANTENER', finalStatus: 'CONFIRMADA' } });
      expect((await nights()).find((period) => period.bookingId === kept.id)?.blockedNights).toEqual(['2026-12-14', '2026-12-15']);
      const inbox = (await (await fetch(`${baseUrl}/notifications`, { headers: auth(guestBookingToken) })).json()).data;
      expect(inbox.some((item: { type: string; entityId: string }) => item.type === 'RESERVA_MANTENIDA' && item.entityId === kept.id)).toBe(true);
    });

    it('35.3 (CA2) cancelar: pasa a CANCELADA con devolución simulada del 100 % y libera el periodo', async () => {
      const res = await resolve(admin, cancelled.id, { decision: 'CANCELAR' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ status: 'CANCELADA', cancellation: { refundPercentage: 100, finalStatus: 'CANCELADA' } });
      expect(body.cancellation.refundAmount).toBe(body.totalAmount);
      expect(body.cancellation.releasedNights).toEqual(['2026-12-18', '2026-12-19', '2026-12-20']);
      expect((await nights()).some((period) => period.bookingId === cancelled.id)).toBe(false);
    });

    it('35.4 una reserva ya resuelta no se resuelve de nuevo y la decisión debe ser válida', async () => {
      expect((await resolve(admin, cancelled.id, { decision: 'MANTENER' })).status).toBe(400);
      expect((await resolve(admin, kept.id, { decision: 'APROBAR' })).status).toBe(400);
      expect((await resolve(admin, 'no-existe', { decision: 'MANTENER' })).status).toBe(404);
      const ids = (await (await fetch(`${baseUrl}/bookings/under-review`, { headers: auth(admin) })).json()).map((item: { id: string }) => item.id);
      expect(ids).not.toContain(kept.id);
      expect(ids).not.toContain(cancelled.id);
    });
  });


  describe('HU-016 · Ofrecer servicios adicionales con costo (CA1, CA2, RF-020, RN-004, RN-013)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const call = async (method: string, path: string, token: string | null, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: token ? auth(token) : json, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const stay = { checkIn: '2026-12-05', checkOut: '2026-12-08', guests: 2 };
    let host: string;
    let listing: string;
    let serviceId: string;
    let bookingId: string;

    beforeAll(async () => {
      const email = `anfitrion.hu016.${randomUUID()}@prueba.com`;
      await call('POST', '/auth/register', null, { name: 'Anfitriona Servicios', email, password: 'Password123', role: 'ANFITRION' });
      host = await login(email, 'Password123');
      const created = await call('POST', '/listings', host, {
        title: 'Cabaña con servicios',
        description: 'Cabaña de prueba para servicios adicionales',
        city: 'Guatapé',
        department: 'Antioquia',
        address: 'Vereda El Roble',
        propertyType: 'CASA',
        maxGuests: 4,
        pricePerNight: 200000,
        amenities: ['WIFI'],
        rules: ['No fumar'],
        images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750'],
      });
      listing = created.body.id;
      await call('POST', `/listings/${listing}/availability-periods`, host, { startDate: '2026-11-01', endDate: '2026-12-31' });
      await call('PATCH', `/listings/${listing}/request-activation`, host);
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      expect((await call('PATCH', `/listings/${listing}/approve`, admin)).status).toBe(200);
    });

    it('36.1 (CA1) el anfitrión agrega un servicio con costo mayor que 0 y aparece en el detalle', async () => {
      const res = await call('POST', `/listings/${listing}/additional-services`, host, { name: 'Desayuno para dos', cost: 45000 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual([{ id: expect.any(String), name: 'Desayuno para dos', cost: 45000 }]);
      serviceId = res.body[0].id;
      const detail = (await call('GET', `/listings/${listing}`, null)).body;
      expect(detail.additionalServices).toEqual([{ id: serviceId, name: 'Desayuno para dos', cost: 45000 }]);
    });

    it('36.2 (CA1) rechaza costo 0, nombre repetido, otros roles y publicaciones ajenas', async () => {
      expect((await call('POST', `/listings/${listing}/additional-services`, host, { name: 'Gratis', cost: 0 })).status).toBe(400);
      expect((await call('POST', `/listings/${listing}/additional-services`, host, { name: 'DESAYUNO PARA DOS', cost: 1000 })).status).toBe(400);
      expect((await call('POST', `/listings/${listing}/additional-services`, guestBookingToken, { name: 'Tour', cost: 1000 })).status).toBe(403);
      expect((await call('POST', `/listings/demo-bogota-chapinero/additional-services`, host, { name: 'Tour', cost: 1000 })).status).toBe(404);
      expect((await call('POST', `/listings/${listing}/additional-services`, null, { name: 'Tour', cost: 1000 })).status).toBe(401);
    });

    it('36.3 (CA1) se puede seleccionar al cotizar y se guarda en la reserva', async () => {
      const quoted = await call('POST', '/bookings/quote', null, { listingId: listing, ...stay, additionalServices: ['Desayuno para dos'] });
      expect(quoted.status).toBe(200);
      expect(quoted.body).toMatchObject({ additionalServices: [{ name: 'Desayuno para dos', cost: 45000 }], additionalServicesTotal: 45000 });

      const booked = await call('POST', '/bookings/instant', guestBookingToken, {
        listingId: listing,
        ...stay,
        additionalServices: ['Desayuno para dos'],
        idempotencyKey: randomUUID(),
      });
      expect(booked.status).toBe(201);
      bookingId = booked.body.id;
    });

    it('36.4 (CA2) modificar el costo aplica a cotizaciones nuevas y no altera la reserva', async () => {
      const res = await call('PATCH', `/listings/${listing}/additional-services/${serviceId}`, host, { cost: 60000 });
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ id: serviceId, cost: 60000 });

      const quoted = await call('POST', '/bookings/quote', null, { listingId: listing, ...stay, additionalServices: ['Desayuno para dos'] });
      expect(quoted.body.additionalServicesTotal).toBe(60000);
      const booking = (await call('GET', `/bookings/${bookingId}`, guestBookingToken)).body;
      expect(booking.additionalServices).toEqual([{ name: 'Desayuno para dos', cost: 45000 }]);
    });

    it('36.5 (CA2) eliminar lo quita de cotizaciones nuevas y la reserva lo conserva', async () => {
      const res = await call('DELETE', `/listings/${listing}/additional-services/${serviceId}`, host);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      expect((await call('POST', '/bookings/quote', null, { listingId: listing, ...stay, additionalServices: ['Desayuno para dos'] })).status).toBe(400);
      expect((await call('GET', `/listings/${listing}`, null)).body.additionalServices).toEqual([]);
      const booking = (await call('GET', `/bookings/${bookingId}`, guestBookingToken)).body;
      expect(booking.additionalServices).toEqual([{ name: 'Desayuno para dos', cost: 45000 }]);
      expect((await call('DELETE', `/listings/${listing}/additional-services/${serviceId}`, host)).status).toBe(404);
    });
  });

  describe('HU-014 · Pausar y reactivar mi publicación (CA1, CA2, CA3, RF-018, RN-005, RN-006)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const call = async (method: string, path: string, token: string | null, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: token ? auth(token) : json, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const title = `Casa para pausar ${randomUUID().slice(0, 8)}`;
    const inSearch = async () =>
      (await call('GET', `/listings/search?city=${encodeURIComponent('Jardín')}&limit=50`, null)).body.data.some((item: { id: string }) => item.id === listing);
    let host: string;
    let listing: string;
    let bookingId: string;

    beforeAll(async () => {
      const email = `anfitrion.hu014.${randomUUID()}@prueba.com`;
      await call('POST', '/auth/register', null, { name: 'Anfitrión Pausa', email, password: 'Password123', role: 'ANFITRION' });
      host = await login(email, 'Password123');
      listing = (
        await call('POST', '/listings', host, {
          title,
          description: 'Casa de prueba para pausar y reactivar',
          city: 'Jardín',
          department: 'Antioquia',
          address: 'Vereda La Linda',
          propertyType: 'CASA',
          maxGuests: 4,
          pricePerNight: 180000,
          amenities: ['WIFI'],
          rules: ['No fumar'],
          images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750'],
        })
      ).body.id;
      await call('POST', `/listings/${listing}/availability-periods`, host, { startDate: '2026-11-01', endDate: '2026-12-31' });
      await call('PATCH', `/listings/${listing}/request-activation`, host);
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      expect((await call('PATCH', `/listings/${listing}/approve`, admin)).status).toBe(200);
      const booked = await call('POST', '/bookings/instant', guestBookingToken, {
        listingId: listing,
        checkIn: '2026-12-10',
        checkOut: '2026-12-12',
        guests: 2,
        idempotencyKey: randomUUID(),
      });
      bookingId = booked.body.id;
      expect((await call('POST', `/bookings/${bookingId}/pay`, guestBookingToken, card)).status).toBe(200);
    });

    it('38.1 solo el anfitrión dueño pausa su publicación', async () => {
      expect((await call('PATCH', `/listings/${listing}/pause`, guestBookingToken)).status).toBe(403);
      expect((await call('PATCH', `/listings/${listing}/pause`, null)).status).toBe(401);
      expect((await call('PATCH', '/listings/demo-bogota-chapinero/pause', host)).status).toBe(404);
      expect((await call('PATCH', `/listings/${listing}/reactivate`, host)).status).toBe(400);
    });

    it('38.2 (CA1, CA3) al pausar pasa a PAUSADA, sale de las búsquedas, no recibe reservas y la reserva confirmada se mantiene', async () => {
      expect(await inSearch()).toBe(true);

      const res = await call('PATCH', `/listings/${listing}/pause`, host);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: listing, status: 'PAUSADA' });
      expect(await inSearch()).toBe(false);
      expect((await call('GET', `/listings/${listing}`, null)).status).toBe(404);
      const newBooking = await call('POST', '/bookings/instant', guestBookingToken, {
        listingId: listing,
        checkIn: '2026-12-20',
        checkOut: '2026-12-22',
        guests: 2,
        idempotencyKey: randomUUID(),
      });
      expect(newBooking.status).toBe(400);
      expect((await call('GET', `/bookings/${bookingId}`, guestBookingToken)).body.status).toBe('CONFIRMADA');
      expect((await call('PATCH', `/listings/${listing}/pause`, host)).status).toBe(400);
    });

    it('38.3 (CA2) al reactivar vuelve a ACTIVA sin nueva revisión y aparece en las búsquedas', async () => {
      const res = await call('PATCH', `/listings/${listing}/reactivate`, host);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: listing, status: 'ACTIVA' });
      expect(await inSearch()).toBe(true);
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      const pending = (await call('GET', '/listings/pending', admin)).body.map((item: { id: string }) => item.id);
      expect(pending).not.toContain(listing);
      expect((await call('GET', `/bookings/${bookingId}`, guestBookingToken)).body.status).toBe('CONFIRMADA');
    });
  });

  describe('37 HU-017 (RF-021, RN-004, RN-016): Asociar una política de cancelación', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...json });
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return ((await res.json()) as { token: string }).token;
    };
    let hostToken: string;
    let draftId: string;

    beforeAll(async () => {
      hostToken = await loginAs('anfitrion.hu017.e2e@stayhub.com', 'ANFITRION');
      const createRes = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(hostToken),
        body: JSON.stringify({
          title: 'Alojamiento para prueba de política',
          description: 'Hermoso alojamiento con vista a la montaña',
          city: 'Manizales',
          department: 'Caldas',
          address: 'Cra 23 # 45-12',
          propertyType: 'CASA',
          maxGuests: 4,
          pricePerNight: 200000,
          amenities: ['WIFI', 'PARQUEADERO'],
          rules: ['No fumar'],
          images: ['https://storage.stayhub.com/manizales-1.jpg'],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      draftId = created.id;
    });

    it('37.1 (CA1) el anfitrión asocia la política Flexible del catálogo y se muestra en el detalle', async () => {
      const catalogRes = await fetch(`${baseUrl}/listings/cancellation-policies`);
      expect(catalogRes.status).toBe(200);
      const catalog = await catalogRes.json();
      expect(catalog.some((p: { code: string }) => p.code === 'FLEXIBLE')).toBe(true);

      const patchRes = await fetch(`${baseUrl}/listings/${draftId}/cancellation-policy`, {
        method: 'PATCH',
        headers: auth(hostToken),
        body: JSON.stringify({ code: 'FLEXIBLE' }),
      });
      expect(patchRes.status).toBe(200);
      const patchBody = await patchRes.json();
      expect(patchBody.code).toBe('FLEXIBLE');

      const detailRes = await fetch(`${baseUrl}/listings/${draftId}`, { headers: auth(hostToken) });
      expect(detailRes.status).toBe(200);
      const detailBody = await detailRes.json();
      expect(detailBody.cancellationPolicy.code).toBe('FLEXIBLE');
      expect(detailBody.cancellationPolicy.name).toBe('Flexible');
    });

    it('37.2 (CA2) si no eligió política, al solicitar activación el sistema asigna Flexible por defecto', async () => {
      const res = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(hostToken),
        body: JSON.stringify({
          title: 'Alojamiento sin política previa',
          description: 'Alojamiento listo para activar',
          city: 'Pereira',
          department: 'Risaralda',
          address: 'Av Circunvalar # 10-20',
          propertyType: 'APARTAMENTO',
          maxGuests: 2,
          pricePerNight: 180000,
          amenities: ['WIFI'],
          rules: ['No mascotas'],
          images: ['https://storage.stayhub.com/pereira-1.jpg'],
        }),
      });
      const draft = await res.json();
      expect(draft.cancellationPolicy).toBeUndefined();

      const actRes = await fetch(`${baseUrl}/listings/${draft.id}/request-activation`, {
        method: 'PATCH',
        headers: auth(hostToken),
      });
      expect(actRes.status).toBe(200);
      const actBody = await actRes.json();
      expect(actBody.status).toBe('PENDIENTE_REVISION');
      expect(actBody.cancellationPolicy).toBe('FLEXIBLE');

      const detailRes = await fetch(`${baseUrl}/listings/${draft.id}`, { headers: auth(hostToken) });
      const detail = await detailRes.json();
      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');

    });
  });

  describe('HU-035 · Consultar las reservas de mis alojamientos (CA1, CA2, RF-049)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const login = async (email: string, password: string) =>
      (await (await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })).json())
        .token as string;
    const call = async (method: string, path: string, token: string | null, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: token ? auth(token) : json, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const suffix = randomUUID().slice(0, 8);
    const guestEmail = `huesped.hu035.${suffix}@prueba.com`;
    let host: string;
    let guest: string;
    let listing: string;
    let confirmed: string;
    let pending: string;

    beforeAll(async () => {
      const email = `anfitrion.hu035.${suffix}@prueba.com`;
      await call('POST', '/auth/register', null, { name: 'Anfitrión Reservas', email, password: 'Password123', role: 'ANFITRION' });
      host = await login(email, 'Password123');
      await call('POST', '/auth/register', null, { name: 'Huésped Contacto', email: guestEmail, password: 'Password123', phone: '300 555 1234', role: 'HUESPED' });
      guest = await login(guestEmail, 'Password123');
      listing = (
        await call('POST', '/listings', host, {
          title: `Casa con reservas ${suffix}`,
          description: 'Casa de prueba para las reservas recibidas',
          city: 'Salento',
          department: 'Quindío',
          address: 'Vereda Palestina',
          propertyType: 'CASA',
          maxGuests: 4,
          pricePerNight: 150000,
          amenities: ['WIFI'],
          rules: ['No fumar'],
          images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750'],
        })
      ).body.id;
      await call('POST', `/listings/${listing}/availability-periods`, host, { startDate: '2027-01-01', endDate: '2027-02-28' });
      await call('PATCH', `/listings/${listing}/request-activation`, host);
      const admin = await login(process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com', process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!');
      expect((await call('PATCH', `/listings/${listing}/approve`, admin)).status).toBe(200);
      const book = async (checkIn: string, checkOut: string, guests: number) =>
        (await call('POST', '/bookings/instant', guest, { listingId: listing, checkIn, checkOut, guests, idempotencyKey: randomUUID() })).body.id as string;
      confirmed = await book('2027-01-20', '2027-01-23', 3);
      expect((await call('POST', `/bookings/${confirmed}/pay`, guest, card)).status).toBe(200);
      pending = await book('2027-01-10', '2027-01-12', 2);
    });

    it('39.1 solo los anfitriones consultan las reservas recibidas', async () => {
      expect((await call('GET', '/bookings/host', null)).status).toBe(401);
      expect((await call('GET', '/bookings/host', guest)).status).toBe(403);
      expect((await call('GET', `/bookings/host/${confirmed}`, guest)).status).toBe(403);
    });

    it('39.2 (CA1) muestra por alojamiento las fechas, el huésped, el número de huéspedes y el estado', async () => {
      const res = await call('GET', '/bookings/host', host);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ listingId: listing, listingCity: 'Salento' });
      expect(res.body[0].bookings.map((item: { id: string }) => item.id)).toEqual([pending, confirmed]);
      expect(res.body[0].bookings[1]).toMatchObject({
        checkIn: '2027-01-20',
        checkOut: '2027-01-23',
        nights: 3,
        guests: 3,
        guestName: 'Huésped Contacto',
        status: 'CONFIRMADA',
      });
      expect(JSON.stringify(res.body)).not.toContain(guestEmail);
      const filtered = await call('GET', '/bookings/host?status=PENDIENTE', host);
      expect(filtered.body[0].bookings.map((item: { id: string }) => item.id)).toEqual([pending]);
    });

    it('39.3 (CA2) el detalle de una reserva CONFIRMADA trae el contacto del huésped; las demás no', async () => {
      const detail = await call('GET', `/bookings/host/${confirmed}`, host);

      expect(detail.status).toBe(200);
      expect(detail.body.guestContact).toEqual({ name: 'Huésped Contacto', email: guestEmail, phone: '300 555 1234' });
      const notConfirmed = await call('GET', `/bookings/host/${pending}`, host);
      expect(notConfirmed.status).toBe(200);
      expect(notConfirmed.body.status).toBe('PENDIENTE');
      expect(notConfirmed.body.guestContact).toBeUndefined();
    });

    it('39.4 otro anfitrión no ve la reserva', async () => {
      const email = `otro.hu035.${suffix}@prueba.com`;
      await call('POST', '/auth/register', null, { name: 'Otro Anfitrión', email, password: 'Password123', role: 'ANFITRION' });
      const other = await login(email, 'Password123');

      expect((await call('GET', `/bookings/host/${confirmed}`, other)).status).toBe(404);
      expect((await call('GET', '/bookings/host', other)).body).toEqual([]);
    });
  });

  describe('HU-011 · Editar mi publicación (CA1, CA2, CA3, RF-015, RN-003, RN-021)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...json });
    const loginAs = async (email: string, role: string) => {
      await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: email, email, password: 'Password123', role }),
      });
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'Password123' }),
      });
      return ((await res.json()) as { token: string }).token;
    };

    let hostToken: string;
    let otherHostToken: string;
    let listingId: string;

    beforeAll(async () => {
      hostToken = await loginAs('host.hu011.contract@stayhub.com', 'ANFITRION');
      otherHostToken = await loginAs('other.hu011.contract@stayhub.com', 'ANFITRION');

      const res = await fetch(`${baseUrl}/listings`, {
        method: 'POST',
        headers: auth(hostToken),
        body: JSON.stringify({
          title: 'Cabaña Contrato Inicial',
          description: 'Cabaña acogedora en el bosque',
          city: 'Manizales',
          department: 'Caldas',
          address: 'Vereda Chipre km 2',
          propertyType: 'CABANA',
          maxGuests: 4,
          pricePerNight: 200000,
          amenities: ['WIFI', 'CHIMENEA'],
          rules: ['No fumar'],
          images: ['https://storage.stayhub.com/manizales-1.jpg'],
          cancellationPolicy: 'FLEXIBLE',
        }),
      });
      const created = await res.json();
      listingId = created.id;
    });

    it('38.1 (CA1) el anfitrión propietario modifica datos válidos y se guarda registrando auditoría', async () => {
      const updateRes = await fetch(`${baseUrl}/listings/${listingId}`, {
        method: 'PATCH',
        headers: auth(hostToken),
        body: JSON.stringify({
          title: 'Cabaña Contrato Renovada con Jacuzzi',
          maxGuests: 6,
          pricePerNight: 250000,
          amenities: ['WIFI', 'CHIMENEA', 'JACUZZI'],
        }),
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.title).toBe('Cabaña Contrato Renovada con Jacuzzi');
      expect(updated.maxGuests).toBe(6);
      expect(updated.pricePerNight).toBe(250000);
      expect(updated.amenities).toContain('JACUZZI');

      // Verificar que el detalle público refleja los cambios
      const detailRes = await fetch(`${baseUrl}/listings/${listingId}`, { headers: auth(hostToken) });
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.title).toBe('Cabaña Contrato Renovada con Jacuzzi');
    });

    it('38.2 (CA2) otro anfitrión recibe 404 al intentar editar una publicación ajena', async () => {
      const updateRes = await fetch(`${baseUrl}/listings/${listingId}`, {
        method: 'PATCH',
        headers: auth(otherHostToken),
        body: JSON.stringify({
          title: 'Intento Ilegítimo de Modificación',
        }),
      });
      expect(updateRes.status).toBe(404);
    });

    it('38.3 (CA3) reservas confirmadas conservan las condiciones pactadas al modificarse precio o política', async () => {
      // Activar y registrar periodo para poder reservar
      await fetch(`${baseUrl}/listings/${listingId}/request-activation`, {
        method: 'PATCH',
        headers: auth(hostToken),
      });
      // admin aprueba con credenciales reales de admin
      const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        }),
      });
      const adminToken = ((await adminLoginRes.json()) as { token: string }).token;

      const approveRes = await fetch(`${baseUrl}/listings/${listingId}/approve`, {
        method: 'PATCH',
        headers: auth(adminToken),
      });
      expect(approveRes.status).toBe(200);

      const periodRes = await fetch(`${baseUrl}/listings/${listingId}/availability-periods`, {
        method: 'POST',
        headers: auth(hostToken),
        body: JSON.stringify({ startDate: '2026-12-01', endDate: '2026-12-20' }),
      });
      expect(periodRes.status).toBe(201);

      const guestToken = await loginAs('guest.hu011.contract@stayhub.com', 'HUESPED');
      const bookingRes = await fetch(`${baseUrl}/bookings/instant`, {
        method: 'POST',
        headers: auth(guestToken),
        body: JSON.stringify({
          listingId,
          checkIn: '2026-12-05',
          checkOut: '2026-12-08',
          guests: 2,
          idempotencyKey: randomUUID(),
        }),
      });
      expect(bookingRes.status).toBe(201);
      const booking = await bookingRes.json();
      const initialTotal = booking.totalAmount;
      const initialNightlyRate = booking.nightlyRate;

      // Anfitrión actualiza precio en la publicación
      const hostEditRes = await fetch(`${baseUrl}/listings/${listingId}`, {
        method: 'PATCH',
        headers: auth(hostToken),
        body: JSON.stringify({
          pricePerNight: 500000,
        }),
      });
      expect(hostEditRes.status).toBe(200);

      // Reserva previa mantiene sus condiciones originales
      const getBookingRes = await fetch(`${baseUrl}/bookings/${booking.id}`, {
        headers: auth(guestToken),
      });
      expect(getBookingRes.status).toBe(200);
      const bookingAfter = await getBookingRes.json();
      expect(bookingAfter.nightlyRate).toBe(initialNightlyRate);
      expect(bookingAfter.totalAmount).toBe(initialTotal);
    });
  });

  describe('HU-008 · Desactivar mi cuenta (CA1, CA2, CA3, RF-011, RN-021)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const call = async (method: string, path: string, token: string | null, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: token ? auth(token) : json, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const signUp = async (prefix: string, role: 'HUESPED' | 'ANFITRION') => {
      const email = `${prefix}.hu008.${randomUUID()}@prueba.com`;
      await call('POST', '/auth/register', null, { name: 'Usuario Desactivación', email, password: 'Password123', role });
      const token = (await call('POST', '/auth/login', null, { email, password: 'Password123' })).body.token as string;
      return { email, token };
    };
    const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped E2E', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };
    const publish = async (hostToken: string, title: string) => {
      const id = (
        await call('POST', '/listings', hostToken, {
          title,
          description: 'Casa de prueba para desactivar la cuenta',
          city: 'Villa de Leyva',
          department: 'Boyacá',
          address: 'Calle 1',
          propertyType: 'CASA',
          maxGuests: 4,
          pricePerNight: 160000,
          amenities: ['WIFI'],
          rules: ['No fumar'],
          images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750'],
        })
      ).body.id as string;
      await call('POST', `/listings/${id}/availability-periods`, hostToken, { startDate: '2027-03-01', endDate: '2027-04-30' });
      await call('PATCH', `/listings/${id}/request-activation`, hostToken);
      const admin = (
        await call('POST', '/auth/login', null, {
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        })
      ).body.token as string;
      expect((await call('PATCH', `/listings/${id}/approve`, admin)).status).toBe(200);
      return id;
    };

    it('40.1 solo huéspedes y anfitriones con sesión desactivan su cuenta', async () => {
      expect((await call('POST', '/users/me/deactivate', null)).status).toBe(401);
      expect((await call('GET', '/users/me/deactivation', null)).status).toBe(401);
    });

    it('40.2 (CA1) sin reservas futuras la cuenta queda DESACTIVADA, la sesión se cierra y se registra el evento', async () => {
      const guest = await signUp('huesped', 'HUESPED');
      expect((await call('GET', '/users/me/deactivation', guest.token)).body).toEqual({ canDeactivate: true, upcomingBookings: [], listingsToPause: [] });

      const res = await call('POST', '/users/me/deactivate', guest.token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'DESACTIVADA', pausedListings: [] });
      expect((await call('GET', '/users/me', guest.token)).status).toBe(401);
      const login = await call('POST', '/auth/login', null, { email: guest.email, password: 'Password123' });
      expect(login.status).toBe(403);
      expect(login.body.reason).toBe('CUENTA_DESACTIVADA');
    });

    it('40.3 (CA2, CA3) con una reserva futura confirmada lo impide; sin ella pausa las publicaciones activas', async () => {
      const host = await signUp('anfitrion', 'ANFITRION');
      const guest = await signUp('huesped', 'HUESPED');
      const listing = await publish(host.token, `Casa para desactivar ${randomUUID().slice(0, 8)}`);
      const booked = await call('POST', '/bookings/instant', guest.token, {
        listingId: listing,
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        guests: 2,
        idempotencyKey: randomUUID(),
      });
      expect((await call('POST', `/bookings/${booked.body.id}/pay`, guest.token, card)).status).toBe(200);

      for (const user of [guest, host]) {
        const blocked = await call('POST', '/users/me/deactivate', user.token);
        expect(blocked.status).toBe(409);
        expect(blocked.body).toMatchObject({ code: 'RESERVAS_FUTURAS_CONFIRMADAS', upcomingBookings: [{ id: booked.body.id, checkIn: '2027-03-10' }] });
        expect((await call('GET', '/users/me', user.token)).body.status).toBe('ACTIVA');
      }
      expect((await call('GET', `/listings/${listing}`, null)).status).toBe(200);

      expect((await call('PATCH', `/bookings/${booked.body.id}/cancel`, guest.token, { reason: 'Cambio de planes' })).status).toBe(200);
      expect((await call('GET', '/users/me/deactivation', host.token)).body).toMatchObject({ canDeactivate: true, listingsToPause: [{ id: listing }] });

      const res = await call('POST', '/users/me/deactivate', host.token);

      expect(res.status).toBe(200);
      expect(res.body.pausedListings).toEqual([expect.objectContaining({ id: listing })]);
      expect((await call('GET', `/listings/${listing}`, null)).status).toBe(404);
    });
  });

  describe('HU-009 · Reactivar mi cuenta (CA1, CA2, RF-012, RN-021)', () => {
    const json = { 'Content-Type': 'application/json' };
    const auth = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
    const call = async (method: string, path: string, token: string | null, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: token ? auth(token) : json, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const email = `anfitrion.hu009.${randomUUID()}@prueba.com`;
    let listing: string;

    beforeAll(async () => {
      await call('POST', '/auth/register', null, { name: 'Anfitrión Reactiva', email, password: 'Password123', role: 'ANFITRION' });
      const host = (await call('POST', '/auth/login', null, { email, password: 'Password123' })).body.token as string;
      listing = (
        await call('POST', '/listings', host, {
          title: `Casa para reactivar ${randomUUID().slice(0, 8)}`,
          description: 'Casa de prueba para reactivar la cuenta',
          city: 'Mompox',
          department: 'Bolívar',
          address: 'Albarrada',
          propertyType: 'CASA',
          maxGuests: 4,
          pricePerNight: 150000,
          amenities: ['WIFI'],
          rules: ['No fumar'],
          images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750'],
        })
      ).body.id;
      await call('POST', `/listings/${listing}/availability-periods`, host, { startDate: '2027-05-01', endDate: '2027-06-30' });
      await call('PATCH', `/listings/${listing}/request-activation`, host);
      const admin = (
        await call('POST', '/auth/login', null, {
          email: process.env.ADMIN_INITIAL_EMAIL ?? 'admin@inversioneslr.com',
          password: process.env.ADMIN_INITIAL_PASSWORD ?? 'AdminLr2026!',
        })
      ).body.token as string;
      expect((await call('PATCH', `/listings/${listing}/approve`, admin)).status).toBe(200);
      expect((await call('POST', '/users/me/deactivate', host)).status).toBe(200);
    });

    it('41.1 (CA1) con credenciales correctas el inicio de sesión ofrece reactivar; con la clave errada no lo revela', async () => {
      const wrong = await call('POST', '/auth/login', null, { email, password: 'OtraClave123' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.reactivationToken).toBeUndefined();

      const res = await call('POST', '/auth/login', null, { email, password: 'Password123' });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ reason: 'CUENTA_DESACTIVADA', reactivationExpiresInMinutes: 10 });
      expect(res.body.token).toBeUndefined();
      expect(typeof res.body.reactivationToken).toBe('string');
    });

    it('41.2 rechaza un token inválido o ausente', async () => {
      expect((await call('POST', '/auth/reactivate', null, { reactivationToken: 'inventado' })).status).toBe(400);
      expect((await call('POST', '/auth/reactivate', null, {})).status).toBe(400);
    });

    it('41.3 (CA2) al confirmar la cuenta vuelve a ACTIVA con sesión y la publicación sigue PAUSADA hasta reactivarla', async () => {
      const offer = await call('POST', '/auth/login', null, { email, password: 'Password123' });

      const res = await call('POST', '/auth/reactivate', null, { reactivationToken: offer.body.reactivationToken });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email: email.toLowerCase(), status: 'ACTIVA' });
      expect((await call('GET', '/users/me', res.body.token)).body.status).toBe('ACTIVA');
      const mine = (await call('GET', '/listings/mine', res.body.token)).body as Array<{ id: string; status: string }>;
      expect(mine.find((item) => item.id === listing)?.status).toBe('PAUSADA');
      expect((await call('GET', `/listings/${listing}`, null)).status).toBe(404);
      expect((await call('POST', '/auth/reactivate', null, { reactivationToken: offer.body.reactivationToken })).status).toBe(400);

      expect((await call('PATCH', `/listings/${listing}/reactivate`, res.body.token)).status).toBe(200);
      expect((await call('GET', `/listings/${listing}`, null)).status).toBe(200);
    });
  });
});
