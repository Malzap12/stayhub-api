import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../../common/enums/role.enum';

export class UserProfileDto {
  @ApiProperty({ example: 'user-1' })
  id: string;

  @ApiProperty({ example: 'Miguel Ángel Alza' })
  name: string;

  @ApiProperty({ example: 'miguel@stayhub.com' })
  email: string;

  @ApiProperty({
    example: '+57 300 123 4567',
    nullable: true,
    type: String,
    description: 'Teléfono de contacto; null si no se registró',
  })
  phone: string | null;

  @ApiProperty({ enum: Role, example: Role.HUESPED })
  role: Role;

  @ApiProperty({ example: 'ACTIVA', enum: ['ACTIVA', 'DESACTIVADA', 'RESTRINGIDA'], description: 'Estado de la cuenta' })
  status: 'ACTIVA' | 'DESACTIVADA' | 'RESTRINGIDA';

  @ApiProperty()
  createdAt: Date;
}
