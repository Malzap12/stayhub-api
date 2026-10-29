import { PartialType } from '@nestjs/swagger';
import { CreateListingDto } from './create-listing.dto';

/**
 * HU-011 · Editar mi publicación (RF-015, RN-003, RN-021).
 * Todos los campos de la publicación son opcionales en la actualización.
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {}
