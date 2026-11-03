import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useDoor } from '../src/hooks/useDoor';
import { requestOpenPacket, reportOpenResult } from '../src/services/door/OpenDoorApi';

jest.mock('../src/services/door/OpenDoorApi', () => ({
  requestOpenPacket: jest.fn(),
  reportOpenResult: jest.fn(async () => undefined),
  flushPendingResults: jest.fn(async () => undefined),
}));
const mockSendPacket = jest.fn();
jest.mock('../src/services/door/DoorService', () =>
  jest.fn().mockImplementation(() => ({ sendPacket: mockSendPacket, cancelSending: jest.fn(), onInfo: undefined }))
);

const issueMock = requestOpenPacket as jest.Mock;
const reportMock = reportOpenResult as jest.Mock;

const okIssue = (extra: object = {}) => ({
  kind: 'ok',
  requestId: 'r1',
  packet: [1, 2, 3],
  signed: true,
  bleid: '301201',
  ...extra,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const makeBle = () => ({
  initialize: jest.fn(async () => true),
  scanAndAutoConnect: jest.fn(),
  requestMtu: jest.fn(async () => 247),
  disconnect: jest.fn(async () => undefined),
  cancelConnect: jest.fn(),
  onError: undefined as any,
  lastConnectError: null as string | null,
});

let api: ReturnType<typeof useDoor>;
const Harness: React.FC<{ ble: any }> = ({ ble }) => {
  api = useDoor(ble);
  return null;
};

const mount = async (ble: any) => {
  await act(async () => {
    ReactTestRenderer.create(<Harness ble={ble} />);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const start = async (options: { bleid?: string; fallbackDeviceName?: string }) => {
  let promise!: ReturnType<typeof api.openRoomDoor>;
  await act(async () => {
    promise = api.openRoomDoor(options);
    await jest.advanceTimersByTimeAsync(0);
  });
  return { promise };
};

describe('useDoor.openRoomDoor 서버 호출과 BLE 연결 동시 진행', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    issueMock.mockReset();
    reportMock.mockClear();
    mockSendPacket.mockReset();
    mockSendPacket.mockResolvedValue({ result: 'OK', responseHex: 'CC8101' });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('서버 요청과 스캔을 동시에 시작하고, 둘 다 끝나야 패킷을 쓴다 (서버가 먼저 끝나는 경우)', async () => {
    const ble = makeBle();
    const connect = deferred<boolean>();
    ble.scanAndAutoConnect.mockReturnValue(connect.promise);
    issueMock.mockResolvedValue(okIssue());
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201', fallbackDeviceName: 'unist_301201' });
    await advance(10);

    // 서버 요청과 스캔이 모두 시작됐다 (서버 응답을 기다리지 않고 스캔 시작)
    expect(issueMock).toHaveBeenCalledWith({ bleid: '301201', retryOf: undefined });
    expect(ble.scanAndAutoConnect).toHaveBeenCalledWith('unist_301201');
    // 패킷은 받았지만 연결이 아직이라 쓰지 않는다
    await advance(2000);
    expect(mockSendPacket).not.toHaveBeenCalled();

    connect.resolve(true);
    await advance(1100);

    expect(mockSendPacket).toHaveBeenCalledTimes(1);
    expect(mockSendPacket).toHaveBeenCalledWith([1, 2, 3], expect.objectContaining({ bulk: true }));
    await advance(600);
    await expect(outcome).resolves.toEqual({ status: 'OK' });
    expect(reportMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', result: 'OK' }));
  });

  it('연결이 먼저 끝나면 서버 응답을 기다리고, 그 시간은 연결 후 고정 대기(1초)에 포함된다', async () => {
    const ble = makeBle();
    ble.scanAndAutoConnect.mockResolvedValue(true); // 즉시 연결
    const issue = deferred<any>();
    issueMock.mockReturnValue(issue.promise);
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201' });
    await advance(600); // 서버가 느려서 600ms 뒤에 응답
    await act(async () => issue.resolve(okIssue()));

    await advance(300); // 연결 후 0.9초: 아직 1초가 안 됐으므로 쓰지 않는다
    expect(mockSendPacket).not.toHaveBeenCalled();
    await advance(200); // 연결 후 1.1초: 쓴다 (서버 대기 0.6초 + 추가 대기 0.4초, 합계 1초)
    expect(mockSendPacket).toHaveBeenCalledTimes(1);

    await advance(600);
    await expect(outcome).resolves.toEqual({ status: 'OK' });
  });

  it('서버가 거절하면 진행 중인 스캔·연결을 즉시 중단하고 패킷을 쓰지 않는다', async () => {
    const ble = makeBle();
    const connect = deferred<boolean>();
    ble.scanAndAutoConnect.mockReturnValue(connect.promise);
    ble.cancelConnect.mockImplementation(() => connect.resolve(false)); // 취소하면 연결 약속이 실패로 끝난다
    issueMock.mockResolvedValue({ kind: 'forbidden', reason: 'stay_expired' });
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201' });
    await advance(100);

    expect(ble.cancelConnect).toHaveBeenCalledTimes(1);
    await expect(outcome).resolves.toEqual({ status: 'FORBIDDEN', reason: 'stay_expired' });
    expect(ble.disconnect).toHaveBeenCalled(); // 혹시 연결됐다면 끊는다
    expect(mockSendPacket).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled(); // 발급된 패킷이 없으므로 보고도 없다
  });

  it('서버에 연결할 수 없으면(오프라인) 스캔을 중단하고 OFFLINE', async () => {
    const ble = makeBle();
    const connect = deferred<boolean>();
    ble.scanAndAutoConnect.mockReturnValue(connect.promise);
    ble.cancelConnect.mockImplementation(() => connect.resolve(false));
    issueMock.mockResolvedValue({ kind: 'offline' });
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201' });
    await advance(100);

    await expect(outcome).resolves.toEqual({ status: 'OFFLINE' });
    expect(ble.cancelConnect).toHaveBeenCalled();
  });

  it('서버가 찾은 문이 앱이 짐작한 문과 다르면 연결을 끊고 올바른 문에 다시 연결한다', async () => {
    const ble = makeBle();
    ble.scanAndAutoConnect.mockResolvedValue(true);
    issueMock.mockResolvedValue(okIssue({ bleid: '302401' }));
    await mount(ble);

    const { promise: outcome } = await start({ fallbackDeviceName: 'unist_301201' }); // bleid 를 모르고 이름만 짐작
    await advance(3000);

    expect(ble.scanAndAutoConnect).toHaveBeenNthCalledWith(1, 'unist_301201');
    expect(ble.scanAndAutoConnect).toHaveBeenNthCalledWith(2, 'unist_302401');
    expect(ble.disconnect).toHaveBeenCalled();
    await expect(outcome).resolves.toEqual({ status: 'OK' });
  });

  it('BLE 연결에 실패하면 BLE_FAIL 과 원인 코드를 보고하고 재시도하지 않는다', async () => {
    const ble = makeBle();
    ble.scanAndAutoConnect.mockRejectedValue(new Error('기기를 찾을 수 없습니다'));
    ble.lastConnectError = 'SCAN_TIMEOUT';
    issueMock.mockResolvedValue(okIssue());
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201' });
    await advance(100);

    await expect(outcome).resolves.toEqual({ status: 'BLE_FAIL' });
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r1', result: 'BLE_FAIL', stage: 'connect:SCAN_TIMEOUT' })
    );
    expect(issueMock).toHaveBeenCalledTimes(1);
    expect(mockSendPacket).not.toHaveBeenCalled();
  });

  it('무응답이면 새 패킷(retryOf)으로 처음부터 다시 한 번만 시도한다', async () => {
    const ble = makeBle();
    ble.scanAndAutoConnect.mockResolvedValue(true);
    issueMock
      .mockResolvedValueOnce(okIssue({ requestId: 'r1' }))
      .mockResolvedValueOnce(okIssue({ requestId: 'r2' }));
    mockSendPacket.mockResolvedValueOnce({ result: 'NO_RESPONSE' }).mockResolvedValueOnce({ result: 'OK' });
    await mount(ble);

    const { promise: outcome } = await start({ bleid: '301201' });
    await advance(5000);

    await expect(outcome).resolves.toEqual({ status: 'OK' });
    expect(issueMock).toHaveBeenNthCalledWith(2, { bleid: '301201', retryOf: 'r1' });
    expect(ble.scanAndAutoConnect).toHaveBeenCalledTimes(2); // 재시도도 서버와 연결을 동시에 시작
    expect(mockSendPacket).toHaveBeenCalledTimes(2);
  });

  describe('블루투스를 쓸 수 없을 때 이유별 결과', () => {
    it.each([
      ['PERMISSION', { status: 'PERMISSION_DENIED' }],
      ['POWERED_OFF', { status: 'BLUETOOTH_OFF' }],
      [null, { status: 'BLE_FAIL' }], // 이유를 모르면 예전과 같은 결과
    ])('초기화 실패 이유 %s', async (reason, expected) => {
      const ble: any = makeBle();
      ble.initialize.mockResolvedValue(false);
      ble.lastInitFailure = reason;
      await mount(ble);

      const { promise: outcome } = await start({ bleid: '301201' });
      await advance(10);

      await expect(outcome).resolves.toEqual(expected);
      expect(issueMock).not.toHaveBeenCalled(); // 서버에 패킷을 요청하지 않는다
      expect(ble.scanAndAutoConnect).not.toHaveBeenCalled();
      expect(reportMock).not.toHaveBeenCalled();
    });
  });
});
