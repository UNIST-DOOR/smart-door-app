// 이 파일을 모듈로 만든다 (다른 테스트 파일과 전역 이름이 겹치지 않게)
export {};

const mockGetBuildNumber = jest.fn(() => '5');
jest.mock('react-native-device-info', () => ({ getBuildNumber: () => mockGetBuildNumber() }));

const fetchMock = jest.fn();
let api: typeof import('../src/lib/api');

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const HOUR = 60 * 60 * 1000;
const authOf = (callIndex: number) => fetchMock.mock.calls[callIndex][1].headers.Authorization;

// 서버 흉내: 토큰 B 만 받아 주고, 나머지는 만료로 거절한다
const serverAcceptingOnlyB = () =>
  fetchMock.mockImplementation(async (_url: string, init: any) =>
    init.headers.Authorization === 'Bearer B' ? respond(200, { ok: true }) : respond(401, { detail: 'Token has expired' })
  );

describe('api 토큰 자동 갱신', () => {
  beforeEach(() => {
    jest.resetModules(); // api.ts 의 모듈 상태(토큰, 진행 중인 갱신 등)를 테스트마다 새로 시작한다
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    api = require('../src/lib/api');
    api.setBaseUrl('http://test');
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const refresher = (impl?: () => Promise<any>) => {
    const fn = jest.fn(impl ?? (async () => ({ accessToken: 'B', expiresOn: Date.now() + HOUR })));
    api.setTokenRefresher(fn);
    return fn;
  };

  describe('평소 동작', () => {
    it('토큰이 충분히 남아 있으면 갱신 없이 그대로 요청한다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      const res = await api.apiGet('/api/me/');

      expect(res).toEqual({ ok: true, status: 200, data: { ok: true } });
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(authOf(0)).toBe('Bearer A');
      expect(fetchMock.mock.calls[0][1].headers['X-App-Build']).toBe('5');
    });

    it('네트워크 오류는 예전처럼 예외로 올라간다', async () => {
      refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockRejectedValue(new Error('Network request failed'));

      await expect(api.apiGet('/api/me/')).rejects.toThrow('Network request failed');
    });

    it('JSON 이 아닌 응답은 문자열로 돌려준다', async () => {
      fetchMock.mockResolvedValue(respond(502, '<html>Bad Gateway</html>'));
      await expect(api.apiGet('/x')).resolves.toEqual({ ok: false, status: 502, data: '<html>Bad Gateway</html>' });
    });

    it('로그인하지 않은 상태에서는 401 이 와도 갱신하지 않는다', async () => {
      const refresh = refresher();
      fetchMock.mockResolvedValue(respond(401, { detail: 'Token is required' }));

      const res = await api.apiGet('/api/me/');

      expect(res.status).toBe(401);
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('서버가 토큰 오류를 줄 때', () => {
    it('401 이면 토큰을 갱신하고 새 토큰으로 한 번 다시 보낸다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      serverAcceptingOnlyB();

      const res = await api.apiGet('/api/room-info/');

      expect(res.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(authOf(0)).toBe('Bearer A');
      expect(authOf(1)).toBe('Bearer B');
    });

    it('예전 서버가 토큰 오류를 403 {"detail"} 로 줘도 같게 처리한다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock
        .mockResolvedValueOnce(respond(403, { detail: 'Invalid token: Signature has expired' }))
        .mockResolvedValueOnce(respond(200, { ok: true }));

      const res = await api.apiGet('/api/room-info/');

      expect(res.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(authOf(1)).toBe('Bearer B');
    });

    it('문을 열 권한이 없는 403({"error":"forbidden"})은 갱신하지 않는다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(403, { ok: false, error: 'forbidden', reason: 'stay_expired' }));

      const res = await api.apiPost('/api/door/open-packet/', { bleid: '301201' });

      expect(res.status).toBe(403);
      expect(res.data.reason).toBe('stay_expired');
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([426, 429, 500, 503])('상태 %i 는 갱신 대상이 아니다', async status => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(status, { ok: false }));

      expect((await api.apiGet('/x')).status).toBe(status);
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('갱신에 실패하면 예외 없이 원래 401 응답을 돌려주고 다시 보내지 않는다', async () => {
      const refresh = refresher(async () => {
        throw new Error('No refresh token');
      });
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(401, { detail: 'Token has expired' }));

      const res = await api.apiGet('/api/me/');

      expect(res.status).toBe(401);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('갱신이 새 토큰을 주지 않아도 원래 응답을 돌려준다', async () => {
      refresher(async () => ({ accessToken: undefined }));
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(401, { detail: 'x' }));

      expect((await api.apiGet('/x')).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('새 토큰으로 다시 보낸 요청도 401 이면 더 반복하지 않는다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      fetchMock.mockResolvedValue(respond(401, { detail: 'Invalid token' }));

      const res = await api.apiGet('/api/me/');

      expect(res.status).toBe(401);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2); // 처음 + 재시도 한 번뿐
    });

    it('POST 도 같은 내용을 새 토큰으로 다시 보낸다', async () => {
      refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      serverAcceptingOnlyB();

      const res = await api.apiPost('/api/door/open-packet/', { bleid: '301201', retryOf: 'r1' });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1].method).toBe('POST');
      expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ bleid: '301201', retryOf: 'r1' }));
      expect(authOf(1)).toBe('Bearer B');
    });

    it('동시에 여러 요청이 401 을 받아도 갱신은 한 번만 하고 모두 새 토큰으로 다시 보낸다', async () => {
      const refreshing = deferred<any>();
      const refresh = refresher(() => refreshing.promise);
      api.setAuthToken('A', Date.now() + HOUR);
      serverAcceptingOnlyB();

      const both = Promise.all([api.apiGet('/api/me/'), api.apiGet('/api/room-info/')]);
      await jest.advanceTimersByTimeAsync(0);
      refreshing.resolve({ accessToken: 'B', expiresOn: Date.now() + HOUR });
      const [me, room] = await both;

      expect(me.status).toBe(200);
      expect(room.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(4); // 처음 2번 + 다시 보낸 2번
    });

    it('다른 요청이 이미 갱신한 뒤 늦게 401 을 받은 요청은 다시 갱신하지 않고 새 토큰으로 보낸다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + HOUR);
      const first = deferred<any>();
      fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(respond(200, { ok: true }));

      const pending = api.apiGet('/api/me/'); // 토큰 A 로 나갔다
      await jest.advanceTimersByTimeAsync(0);
      api.setAuthToken('B', Date.now() + HOUR); // 그 사이 다른 요청이 토큰을 갱신했다
      first.resolve(respond(401, { detail: 'Token has expired' }));

      expect((await pending).status).toBe(200);
      expect(refresh).not.toHaveBeenCalled();
      expect(authOf(1)).toBe('Bearer B');
    });
  });

  describe('만료 직전 미리 갱신', () => {
    it('만료 2분 안이면 요청을 보내기 전에 갱신하고, 새 토큰으로 한 번만 보낸다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + 60 * 1000);
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      await api.apiGet('/api/me/');

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(authOf(0)).toBe('Bearer B');
    });

    it('이미 만료된 토큰도 미리 갱신해서 처음부터 새 토큰으로 보낸다 (백그라운드 복귀 시나리오)', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() - 30 * 60 * 1000); // 30분 전에 만료
      serverAcceptingOnlyB();

      const res = await api.apiGet('/api/room-info/');

      expect(res.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1); // 만료된 토큰으로 헛되이 보내지 않는다
    });

    it('만료 시각을 모르면 미리 갱신하지 않고 401 을 받았을 때만 갱신한다', async () => {
      const refresh = refresher();
      api.setAuthToken('A'); // 만료 시각 없음
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      await api.apiGet('/x');
      expect(refresh).not.toHaveBeenCalled();
    });

    it('초 단위로 들어온 만료 시각도 올바르게 해석한다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Math.floor(Date.now() / 1000) + 3600); // 1시간 뒤 (초 단위)
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      await api.apiGet('/x');
      expect(refresh).not.toHaveBeenCalled(); // 밀리초로 잘못 읽으면 1970년이라 매번 갱신하게 된다
    });

    it('미리 갱신한 토큰도 거절당하면 또 갱신하지 않는다', async () => {
      const refresh = refresher();
      api.setAuthToken('A', Date.now() + 30 * 1000);
      fetchMock.mockResolvedValue(respond(401, { detail: 'Invalid token' }));

      expect((await api.apiGet('/x')).status).toBe(401);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('갱신이 실패하면 기존 토큰으로 그대로 요청하고, 30초 동안은 매 요청마다 갱신을 시도하지 않는다', async () => {
      const refresh = refresher(async () => {
        throw new Error('offline');
      });
      api.setAuthToken('A', Date.now() + 30 * 1000);
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      await api.apiGet('/x');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(authOf(0)).toBe('Bearer A');

      await api.apiGet('/x'); // 방금 실패했으니 기다리지 않고 바로 보낸다
      expect(refresh).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(31 * 1000);
      api.setAuthToken('A', Date.now() + 10 * 1000);
      await api.apiGet('/x');
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('갱신이 10초 안에 끝나지 않으면 기다리지 않고 기존 토큰으로 진행한다', async () => {
      refresher(() => new Promise(() => {})); // 응답이 없는 갱신
      api.setAuthToken('A', Date.now() + 30 * 1000);
      fetchMock.mockResolvedValue(respond(200, { ok: true }));

      const pending = api.apiGet('/x');
      await jest.advanceTimersByTimeAsync(9999);
      expect(fetchMock).not.toHaveBeenCalled(); // 아직 기다리는 중
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
      expect(authOf(0)).toBe('Bearer A');
    });
  });

  describe('로그아웃과 겹칠 때', () => {
    it('갱신하는 동안 로그아웃하면 갱신된 토큰으로 로그인 상태를 되살리지 않는다', async () => {
      const refreshing = deferred<any>();
      refresher(() => refreshing.promise);
      api.setAuthToken('A', Date.now() + 30 * 1000);
      fetchMock.mockResolvedValue(respond(401, { detail: 'Token is required' }));

      const pending = api.apiGet('/x');
      await jest.advanceTimersByTimeAsync(0);
      api.setAuthToken(null); // 로그아웃
      refreshing.resolve({ accessToken: 'B', expiresOn: Date.now() + HOUR });
      await pending;

      fetchMock.mockClear();
      fetchMock.mockResolvedValue(respond(200, {}));
      await api.apiGet('/y');
      expect(authOf(0)).toBeUndefined(); // 토큰이 되살아나지 않았다
    });

    it('401 때문에 갱신을 시작한 뒤 로그아웃하면 요청을 다시 보내지 않는다', async () => {
      const refreshing = deferred<any>();
      refresher(() => refreshing.promise);
      api.setAuthToken('A', Date.now() + HOUR); // 만료 직전이 아니라 401 을 받아서 갱신이 시작된다
      fetchMock.mockResolvedValue(respond(401, { detail: 'Token has expired' }));

      const pending = api.apiGet('/api/me/');
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1); // 첫 요청이 401 을 받고 갱신을 기다리는 중
      api.setAuthToken(null); // 로그아웃
      refreshing.resolve({ accessToken: 'B', expiresOn: Date.now() + HOUR });

      expect((await pending).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1); // 로그아웃한 뒤에 토큰 없이 다시 보내지 않는다
    });
  });
});
