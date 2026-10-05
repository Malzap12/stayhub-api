import { Injectable } from '@nestjs/common';

@Injectable()
export class ListingsService {
  async findAll(query: any) {
    return [];
  }
  async findOne(id: string) {
    return { id, title: 'Alojamiento demo' };
  }
  async create(data: any) {
    return { message: 'Publicación creada en estado BORRADOR', data };
  }
}
