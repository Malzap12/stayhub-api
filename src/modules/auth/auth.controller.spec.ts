import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should login user and return JWT token', async () => {
    const result = await controller.login({
      email: 'miguel@stayhub.com',
      password: 'Password123!',
    });
    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
  });

  it('should register new user', async () => {
    const result = await controller.register({
      name: 'Miguel Ángel Alza',
      email: 'miguel@stayhub.com',
      password: 'Password123!',
      role: Role.ANFITRION,
    });
    expect(result).toBeDefined();
    expect(result.user.email).toBe('miguel@stayhub.com');
  });
});
