import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  async login(credentials: any) {
    return { message: 'Login exitoso', token: 'mock-jwt-token' };
  }

  async register(userData: any) {
    return { message: 'Usuario registrado correctamente', user: userData };
  }
}
