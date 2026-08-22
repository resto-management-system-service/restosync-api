import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';

type MockJwtService = { verifyAsync: jest.Mock };
type MockConfigService = { get: jest.Mock };

function createMockJwtService(): MockJwtService {
  return { verifyAsync: jest.fn() };
}

function createMockConfigService(): MockConfigService {
  return { get: jest.fn(() => 'test-secret') };
}

function createSocket(token?: string): Socket {
  return {
    handshake: { auth: token === undefined ? {} : { token } },
    data: {},
    disconnect: jest.fn(),
  } as unknown as Socket;
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwt: MockJwtService;
  let config: MockConfigService;

  beforeEach(() => {
    jwt = createMockJwtService();
    config = createMockConfigService();
    gateway = new RealtimeGateway(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  it('accepts a connection with a valid JWT and stores the authenticated user', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'cook@restosync.dev',
      role: 'KITCHEN',
    });

    const socket = createSocket('valid.token');
    await gateway.handleConnection(socket);

    expect(jwt.verifyAsync).toHaveBeenCalledWith('valid.token', {
      secret: 'test-secret',
    });
    expect(socket.data.user).toEqual({
      userId: 'user-1',
      email: 'cook@restosync.dev',
      role: 'KITCHEN',
    });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a connection with a missing JWT', async () => {
    const socket = createSocket();
    await gateway.handleConnection(socket);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(socket.data.user).toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a connection with an invalid JWT', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    const socket = createSocket('invalid.token');
    await gateway.handleConnection(socket);

    expect(socket.data.user).toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
