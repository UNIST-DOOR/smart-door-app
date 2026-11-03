const mockApiGet = jest.fn();
jest.mock('react-native-device-info', () => ({ getBuildNumber: () => '5' }));
jest.mock('../src/lib/api', () => ({
  ...jest.requireActual('../src/lib/api'),
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

import { checkSession, toUserInfo } from '../src/services/auth/session';

const res = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, data });

const ROOM_OK = {
  ok: true,
  found: true,
  upn: 'student@unist.ac.kr',
  building: '301',
  room: '201',
  bleId: 301201,
  checkInDate: '20260301',
  checkInTime: '00:00',
  checkOutDate: '20261231',
  checkOutTime: '00:00',
};

// 경로별로 응답을 정해 준다
const serverReplies = (me: unknown, room: unknown) =>
  mockApiGet.mockImplementation(async (path: string) => {
    const reply = path.includes('room-info') ? room : me;
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  });

describe('checkSession: 서버 응답을 분류한다', () => {
  beforeEach(() => mockApiGet.mockReset());

  it('정상: 사용자 정보를 만든다 (기존 화면이 쓰던 형식 그대로)', async () => {
    serverReplies(res(200, { ok: true, name: '학생' }), res(200, ROOM_OK));

    await expect(checkSession()).resolves.toEqual({
      kind: 'ok',
      user: {
        username: 'student@unist.ac.kr',
        name: '학생',
        building: '301',
        room: '201',
        bleId: '301201',
        checkInDate: '20260301',
        checkInTime: '00:00',
        checkOutDate: '20261231',
        checkOutTime: '00:00',
      },
    });
    expect(mockApiGet).toHaveBeenCalledWith('/api/me/');
    expect(mockApiGet).toHaveBeenCalledWith('/api/room-info/');
  });

  it('선택 항목이 없으면 undefined 로 둔다', () => {
    expect(toUserInfo({ name: 'n' }, { ...ROOM_OK, bleId: undefined, checkInDate: undefined })).toMatchObject({
      bleId: undefined,
      checkInDate: undefined,
    });
  });

  it('내 정보 조회가 실패해도 방 정보가 있으면 정상으로 본다 (이름만 빈 값)', async () => {
    serverReplies(res(500, { ok: false }), res(200, ROOM_OK));
    const result: any = await checkSession();
    expect(result.kind).toBe('ok');
    expect(result.user.name).toBe('');
  });

  describe('방 정보 없음 — 서버가 조회를 마치고 "없다"고 답한 경우만', () => {
    it('found: false', async () => {
      serverReplies(
        res(200, { ok: true }),
        res(200, { ok: false, found: false, reason: 'No room mapped for student id' })
      );
      await expect(checkSession()).resolves.toEqual({ kind: 'no_room', reason: 'No room mapped for student id' });
    });
  });

  describe('서버나 네트워크 문제 — 방 정보 없음으로 오해하면 안 된다', () => {
    it.each([
      ['500 (DB 오류 등)', res(500, { ok: false, error: '(2013, "Lost connection")' })],
      ['503 (DB 복구 실패)', res(503, { ok: false, error: 'db_unavailable' })],
      ['503 (인증 서비스 불가)', res(503, { detail: 'Authentication service temporarily unavailable', error: 'auth_unavailable' })],
      ['429', res(429, { ok: false })],
      ['502 (HTML 응답)', res(502, '<html>Bad Gateway</html>')],
      ['400', res(400, { ok: false, error: 'UPN not found in token' })],
      ['200 인데 found 가 없는 이상한 응답', res(200, { ok: false })],
      ['빈 응답', res(200, '')],
    ])('%s', async (_name, room) => {
      serverReplies(res(200, { ok: true }), room);
      await expect(checkSession()).resolves.toEqual({ kind: 'unavailable' });
    });

    it('연결 실패(예외)', async () => {
      serverReplies(res(200, { ok: true }), new TypeError('Network request failed'));
      await expect(checkSession()).resolves.toEqual({ kind: 'unavailable' });
    });

    it('내 정보 조회가 연결 실패해도 마찬가지', async () => {
      serverReplies(new TypeError('Network request failed'), res(200, ROOM_OK));
      await expect(checkSession()).resolves.toEqual({ kind: 'unavailable' });
    });
  });

  describe('토큰 거절', () => {
    it.each([
      ['401', res(401, { detail: 'Token has expired', error: 'unauthorized' })],
      ['예전 서버의 403 {"detail"}', res(403, { detail: 'Invalid token: Signature has expired' })],
    ])('%s', async (_name, rejected) => {
      serverReplies(rejected, rejected);
      await expect(checkSession()).resolves.toEqual({ kind: 'token_rejected' });
    });

    it('방 정보만 거절돼도 토큰 거절', async () => {
      serverReplies(res(200, { ok: true }), res(401, { detail: 'x' }));
      await expect(checkSession()).resolves.toEqual({ kind: 'token_rejected' });
    });

    it('문을 열 권한이 없는 403 은 토큰 거절이 아니다', async () => {
      serverReplies(res(200, { ok: true }), res(403, { ok: false, error: 'forbidden' }));
      await expect(checkSession()).resolves.toEqual({ kind: 'unavailable' });
    });
  });

  describe('앱 업데이트 필요', () => {
    it('426', async () => {
      const upgrade = res(426, { ok: false, error: 'upgrade_required', minBuild: 6, yourBuild: 5 });
      serverReplies(upgrade, upgrade);
      await expect(checkSession()).resolves.toEqual({ kind: 'upgrade_required' });
    });

    it('본문의 error 가 upgrade_required 인 경우', async () => {
      serverReplies(res(200, { ok: true }), res(200, { ok: false, error: 'upgrade_required' }));
      await expect(checkSession()).resolves.toEqual({ kind: 'upgrade_required' });
    });
  });
});
