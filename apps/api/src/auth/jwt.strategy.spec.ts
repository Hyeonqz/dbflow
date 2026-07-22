import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';
import { Role } from '@prisma/client';

const mockUser = {
  id: 'user-uuid-1',
  email: 'dev@dbflow.io',
  name: '개발자',
  department: '개발팀',
  role: Role.DEVELOPER,
  passwordHash: 'hashed',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUsersService: Partial<UsersService> = {
  findById: jest.fn(),
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy(mockUsersService as UsersService);
    jest.clearAllMocks();
  });

  it('returns { userId, role, name, department } from the DB record when user exists', async () => {
    (mockUsersService.findById as jest.Mock).mockResolvedValue(mockUser);

    const result = await strategy.validate({ sub: mockUser.id, role: 'DEVELOPER' });

    expect(mockUsersService.findById).toHaveBeenCalledWith(mockUser.id);
    expect(result).toEqual({ userId: mockUser.id, role: Role.DEVELOPER, name: mockUser.name, department: mockUser.department });
  });

  it('throws UnauthorizedException when user no longer exists', async () => {
    (mockUsersService.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user-id', role: 'DEVELOPER' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockUsersService.findById).toHaveBeenCalledWith('deleted-user-id');
  });
});
