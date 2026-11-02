import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost } from '../src/lib/api';
import { flushPendingResults, reportOpenResult, requestOpenPacket } from '../src/services/door/OpenDoorApi';
import { hexToBytes } from '../src/utils/helpers';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('../src/lib/api', () => ({ apiPost: jest.fn() }));

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
    [500, { ok: false }, { kind: 'error' }],
  ])('상태 %i 를 구분한다', async (status, data, expected) => {
    post.mockResolvedValue({ ok: false, status, data });
    await expect(requestOpenPacket({})).resolves.toEqual(expected);
  });

  it('통신 불가면 offline', async () => {
    post.mockRejectedValue(new Error('Network request failed'));
    await expect(requestOpenPacket({})).resolves.toEqual({ kind: 'offline' });
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
