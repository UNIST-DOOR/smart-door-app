// 이 파일을 모듈로 만든다 (다른 테스트 파일과 전역 이름이 겹치지 않게)
export {};

const mockRefresh = jest.fn();
const mockAuthorize = jest.fn();
const mockStorage = {
  getTokens: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
};

jest.mock('react-native-app-auth', () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
  refresh: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock('../src/services/auth/AuthStorage', () => ({ AuthStorage: mockStorage }));

type AuthServiceType = typeof import('../src/services/auth/AuthService').default;
let auth: AuthServiceType;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const refreshed = (accessToken: string) => ({
  accessToken,
  idToken: 'id',
  refreshToken: 'R2',
  accessTokenExpirationDate: '2026-11-03T13:00:00Z',
});

// 테스트 환경에서는 iOS 네이티브 모듈(MSALModule)이 없어서 안드로이드와 같은 갱신 경로를 탄다
describe('AuthService.refreshTokens', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRefresh.mockReset();
    mockAuthorize.mockReset();
    Object.values(mockStorage).forEach(fn => fn.mockReset());
    mockStorage.getTokens.mockResolvedValue({ accessToken: 'old', refreshToken: 'R1' });
    mockStorage.setTokens.mockResolvedValue(undefined);
    mockStorage.clearTokens.mockResolvedValue(undefined);
    auth = require('../src/services/auth/AuthService').default;
  });

  it('갱신하고 새 토큰을 저장한다', async () => {
    mockRefresh.mockResolvedValue(refreshed('NEW'));

    const tokens = await auth.refreshTokens();

    expect(tokens.accessToken).toBe('NEW');
    expect(tokens.refreshToken).toBe('R2');
    expect(tokens.expiresOn).toBe(new Date('2026-11-03T13:00:00Z').getTime());
    expect(mockRefresh).toHaveBeenCalledWith(expect.anything(), { refreshToken: 'R1' });
    expect(mockStorage.setTokens).toHaveBeenCalledTimes(1);
  });

  it('동시에 여러 곳에서 불러도 실제 갱신은 한 번만 하고 같은 결과를 돌려준다', async () => {
    const pending = deferred<any>();
    mockRefresh.mockReturnValue(pending.promise);

    const a = auth.refreshTokens();
    const b = auth.refreshTokens();
    const c = auth.refreshTokens();
    pending.resolve(refreshed('NEW'));

    const results = await Promise.all([a, b, c]);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockStorage.setTokens).toHaveBeenCalledTimes(1);
    expect(results.map(r => r.accessToken)).toEqual(['NEW', 'NEW', 'NEW']);
  });

  it('끝난 뒤에는 다음 호출이 새로 갱신한다', async () => {
    mockRefresh.mockResolvedValueOnce(refreshed('ONE')).mockResolvedValueOnce(refreshed('TWO'));

    expect((await auth.refreshTokens()).accessToken).toBe('ONE');
    expect((await auth.refreshTokens()).accessToken).toBe('TWO');
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('실패하면 기다리던 모두에게 실패를 알리고, 다음 호출은 다시 시도할 수 있다', async () => {
    const pending = deferred<any>();
    mockRefresh.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(refreshed('NEW'));

    const a = auth.refreshTokens();
    const b = auth.refreshTokens();
    const settled = Promise.allSettled([a, b]);
    pending.reject(new Error('network down'));

    const results = await settled;
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
    expect(mockStorage.setTokens).not.toHaveBeenCalled();

    expect((await auth.refreshTokens()).accessToken).toBe('NEW'); // 실패가 남아 막히지 않는다
  });

  it('갱신 토큰이 없으면 갱신하지 못한다', async () => {
    mockStorage.getTokens.mockResolvedValue({ accessToken: 'old' });
    await expect(auth.refreshTokens()).rejects.toThrow('No refresh token');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('갱신하는 동안 로그아웃하면 갱신 결과를 저장하지 않는다 (로그아웃이 취소되지 않는다)', async () => {
    const pending = deferred<any>();
    mockRefresh.mockReturnValue(pending.promise);

    const refreshing = auth.refreshTokens();
    await Promise.resolve();
    await auth.clearStoredTokens(); // 갱신 도중 로그아웃
    pending.resolve(refreshed('NEW'));

    await expect(refreshing).rejects.toThrow('Signed out during token refresh');
    expect(mockStorage.setTokens).not.toHaveBeenCalled();
    expect(mockStorage.clearTokens).toHaveBeenCalledTimes(1);
  });

  it('로그아웃 전에 시작한 갱신이 아니면 영향을 받지 않는다', async () => {
    await auth.clearStoredTokens();
    mockRefresh.mockResolvedValue(refreshed('NEW'));

    expect((await auth.refreshTokens()).accessToken).toBe('NEW');
    expect(mockStorage.setTokens).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.reauthRequired: Azure 가 갱신 토큰을 명확히 거부했는가', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRefresh.mockReset();
    mockAuthorize.mockReset();
    Object.values(mockStorage).forEach(fn => fn.mockReset());
    mockStorage.getTokens.mockResolvedValue({ accessToken: 'old', refreshToken: 'R1' });
    mockStorage.setTokens.mockResolvedValue(undefined);
    mockStorage.clearTokens.mockResolvedValue(undefined);
    auth = require('../src/services/auth/AuthService').default;
  });

  it('처음에는 false', () => {
    expect(auth.reauthRequired).toBe(false);
  });

  it('Azure 가 갱신 토큰을 거부하면(invalid_grant) true', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('AADSTS700082: expired due to inactivity'), { code: 'invalid_grant' }));

    await expect(auth.refreshTokens()).rejects.toThrow('AADSTS700082');
    expect(auth.reauthRequired).toBe(true);
  });

  it('네트워크 오류로 실패해도 true 가 되지 않는다 (그래서 로그인 정보를 지우지 않는다)', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('Network error'), { code: 'token_refresh_failed' }));

    await expect(auth.refreshTokens()).rejects.toThrow('Network error');
    expect(auth.reauthRequired).toBe(false);
  });

  it('갱신 토큰이 저장돼 있지 않으면 true', async () => {
    mockStorage.getTokens.mockResolvedValue({ accessToken: 'old' });
    await expect(auth.refreshTokens()).rejects.toThrow('No refresh token');
    expect(auth.reauthRequired).toBe(true);
  });

  it('거부된 뒤에 갱신에 성공하면 false 로 돌아간다', async () => {
    mockRefresh.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'invalid_grant' }));
    await expect(auth.refreshTokens()).rejects.toThrow();
    expect(auth.reauthRequired).toBe(true);

    mockRefresh.mockResolvedValueOnce(refreshed('NEW'));
    await auth.refreshTokens();
    expect(auth.reauthRequired).toBe(false);
  });

  it('거부된 뒤에 일시적인 오류가 나도 true 가 유지되지는 않는다고 가정하지 않는다 (마지막으로 확인된 상태를 유지)', async () => {
    mockRefresh.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'invalid_grant' }));
    await expect(auth.refreshTokens()).rejects.toThrow();

    mockRefresh.mockRejectedValueOnce(Object.assign(new Error('Network error'), { code: 'token_refresh_failed' }));
    await expect(auth.refreshTokens()).rejects.toThrow();

    expect(auth.reauthRequired).toBe(true); // 이미 거부된 계정이다. 네트워크 오류가 그 사실을 바꾸지 않는다
  });

  it('로그아웃하면 false 로 돌아간다', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('x'), { code: 'invalid_grant' }));
    await expect(auth.refreshTokens()).rejects.toThrow();
    expect(auth.reauthRequired).toBe(true);

    await auth.clearStoredTokens();
    expect(auth.reauthRequired).toBe(false);
  });

  it('새로 로그인하면 false 로 돌아간다', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('x'), { code: 'invalid_grant' }));
    await expect(auth.refreshTokens()).rejects.toThrow();
    expect(auth.reauthRequired).toBe(true);

    mockAuthorize.mockResolvedValue({ accessToken: 'A', idToken: 'I', refreshToken: 'R', accessTokenExpirationDate: '2026-11-03T13:00:00Z' });
    await auth.signInInteractive();
    expect(auth.reauthRequired).toBe(false);
  });
});
