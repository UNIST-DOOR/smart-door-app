import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost } from '../src/lib/api';
import {
  OPEN_PACKET_TIMEOUT_MS,
  flushPendingResults,
  reportOpenResult,
  requestOpenPacket,
} from '../src/services/door/OpenDoorApi';
import { hexToBytes } from '../src/utils/helpers';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('react-native-device-info', () => ({ getBuildNumber: () => '5' }));
// 토큰 오류 판단(isTokenFailure)은 실제 코드를 쓰고, 서버 호출(apiPost)만 가짜로 바꾼다
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), apiPost: jest.fn() }));

const post = apiPost as jest.Mock;
const PENDING_KEY = 'PENDING_OPEN_RESULTS';

beforeEach(async () => {
  post.mockReset();
  await AsyncStorage.clear();
});

describe('hexToBytes', () => {
  it('공백과 대소문자를 무시한다', () => {
    expect(hexToBytes('CC 01 2f')).toEqual([0xcc, 0x01, 0x2f]);
  });
  it.each(['', 'abc', 'zz', 'a'.repeat(130)])('잘못된 입력은 null: %s', value => {
    expect(hexToBytes(value)).toBeNull();
  });
});

describe('requestOpenPacket', () => {
  it('정상 응답을 바이트로 변환한다', async () => {
    post.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true, requestId: 'r1', packetHex: 'cc012f', signed: true, bleid: '306301' },
    });
    await expect(requestOpenPacket({ bleid: '306301' })).resolves.toEqual({
      kind: 'ok',
      requestId: 'r1',
      packet: [0xcc, 0x01, 0x2f],
      signed: true,
      bleid: '306301',
    });
    expect(post).toHaveBeenCalledWith('/api/door/open-packet/', { bleid: '306301', retryOf: undefined });
  });

  it.each([
    [426, { ok: false, error: 'upgrade_required' }, { kind: 'upgrade_required' }],
    [401, { detail: 'x' }, { kind: 'unauthorized' }],
    [403, { ok: false, reason: 'stay_expired' }, { kind: 'forbidden', reason: 'stay_expired' }],
    [429, { ok: false }, { kind: 'rate_limited' }],
    [500, { ok: false }, { kind: 'server_error' }],
    [503, { ok: false, error: 'db_unavailable' }, { kind: 'server_error' }],
    [502, '<html>Bad Gateway</html>', { kind: 'server_error' }],
    [400, { ok: false, error: 'UPN not found in token' }, { kind: 'error' }],
  ])('상태 %i 를 구분한다', async (status, data, expected) => {
    post.mockResolvedValue({ ok: false, status, data });
    await expect(requestOpenPacket({})).resolves.toEqual(expected);
  });

  describe('토큰 만료를 "권한 없음"으로 오해하지 않는다', () => {
    it('예전 서버가 토큰 오류를 403 {"detail"} 로 줘도 unauthorized 다 (이전에는 forbidden 으로 안내됐다)', async () => {
      post.mockResolvedValue({ ok: false, status: 403, data: { detail: 'Invalid token: Signature has expired' } });
      await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'unauthorized' });
    });

    it('토큰이 없다는 403 도 unauthorized', async () => {
      post.mockResolvedValue({ ok: false, status: 403, data: { detail: 'Token is required' } });
      await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'unauthorized' });
    });

    it('진짜 권한 거절(403 {"error":"forbidden"})은 reason 과 함께 forbidden 이다', async () => {
      post.mockResolvedValue({ ok: false, status: 403, data: { ok: false, error: 'forbidden', reason: 'bleid_mismatch' } });
      await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'forbidden', reason: 'bleid_mismatch' });
    });
  });

  it('통신 불가면 offline', async () => {
    post.mockRejectedValue(new Error('Network request failed'));
    await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'offline' });
  });

  it('서버가 제한 시간 안에 응답하지 않으면 offline 으로 끝낸다', async () => {
    jest.useFakeTimers();
    try {
      post.mockReturnValue(new Promise(() => {})); // 영원히 응답하지 않는 서버
      const result = requestOpenPacket({});
      await jest.advanceTimersByTimeAsync(OPEN_PACKET_TIMEOUT_MS - 1);
      let settled = false;
      result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false); // 제한 시간 직전까지는 기다린다
      await jest.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ kind: 'offline' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('제한 시간 안에 응답하면 타이머를 남기지 않는다', async () => {
    jest.useFakeTimers();
    try {
      post.mockResolvedValue({ ok: false, status: 403, data: { reason: 'no_room' } });
      await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'forbidden', reason: 'no_room' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('packetHex 가 잘못되면 error', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { ok: true, requestId: 'r1', packetHex: 'xyz' } });
    await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'error' });
  });
});

describe('reportOpenResult', () => {
  const report = { requestId: 'r1', result: 'OK' as const, stage: 'response', elapsedMs: 1800 };

  it('성공하면 저장하지 않는다', async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await reportOpenResult(report);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('통신이 안 되면 저장해 두었다가 다음에 보낸다', async () => {
    post.mockRejectedValue(new Error('offline'));
    await reportOpenResult(report);
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) as string)).toHaveLength(1);

    post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await flushPendingResults();

    expect(post).toHaveBeenLastCalledWith('/api/door/open-result/', expect.objectContaining({ requestId: 'r1' }));
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) as string)).toHaveLength(0);
  });

  it('서버가 404 로 거절하면 저장하지 않는다 (다시 보내도 소용없음)', async () => {
    post.mockResolvedValue({ ok: false, status: 404, data: { error: 'request_not_found' } });
    await reportOpenResult(report);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('보내다 실패하면 거기서 멈추고 나머지는 남긴다', async () => {
    post.mockRejectedValue(new Error('offline'));
    await reportOpenResult({ ...report, requestId: 'a' });
    await reportOpenResult({ ...report, requestId: 'b' });

    post.mockReset();
    post.mockRejectedValue(new Error('still offline'));
    await flushPendingResults();

    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) as string)).toHaveLength(2);
  });
});
