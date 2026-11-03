import { PermissionsAndroid, Platform } from 'react-native';
import BleService from '../src/services/ble/BleService';
import { BLE_UUIDS } from '../src/utils/constants';

const mockManager = {
  startDeviceScan: jest.fn(),
  stopDeviceScan: jest.fn(),
  connectToDevice: jest.fn(),
  cancelDeviceConnection: jest.fn(),
  state: jest.fn(),
  destroy: jest.fn(),
};
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn(() => mockManager),
  ScanMode: { LowLatency: 2 },
}));

const makeDevice = (withService = true) => ({
  id: 'D1',
  name: 'unist_301201',
  discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
  services: jest.fn(async () =>
    withService
      ? [
          {
            uuid: BLE_UUIDS.MAIN_UUID,
            characteristics: async () => [
              { uuid: BLE_UUIDS.COMMAND_UUID },
              { uuid: BLE_UUIDS.NOTIFY_UUID, monitor: jest.fn(async () => ({})) },
            ],
          },
        ]
      : []
  ),
});

const gattError = () => Object.assign(new Error('Device disconnected'), { errorCode: 201, androidErrorCode: 133 });

describe('BleService 연결 안정성', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.values(mockManager).forEach(fn => fn.mockReset());
    mockManager.cancelDeviceConnection.mockResolvedValue(undefined);
    // 10ms 뒤에 대상 기기가 스캔된다
    mockManager.startDeviceScan.mockImplementation((_uuids: any, _opts: any, cb: any) => {
      setTimeout(() => cb(null, { id: 'D1', name: 'unist_301201', rssi: -50 }), 10);
    });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('처음 연결이 되면 재시도하지 않는다', async () => {
    mockManager.connectToDevice.mockResolvedValue(makeDevice());
    const service = new BleService();

    const promise = service.scanAndAutoConnect('unist_301201');
    await jest.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe(true);
    expect(mockManager.connectToDevice).toHaveBeenCalledTimes(1);
    expect(mockManager.startDeviceScan).toHaveBeenCalledWith(null, { scanMode: 2 }, expect.any(Function)); // 저지연 스캔
    expect(mockManager.cancelDeviceConnection).not.toHaveBeenCalled();
    expect(service.lastConnectError).toBeNull();
  });

  it('GATT 연결이 실패하면 연결을 정리하고 같은 기기에 한 번 더 연결해 성공한다', async () => {
    mockManager.connectToDevice.mockRejectedValueOnce(gattError()).mockResolvedValueOnce(makeDevice());
    const service = new BleService();

    const promise = service.scanAndAutoConnect('unist_301201');
    await jest.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toBe(true);
    expect(mockManager.connectToDevice).toHaveBeenCalledTimes(2);
    expect(mockManager.connectToDevice).toHaveBeenNthCalledWith(2, 'D1', expect.anything());
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith('D1'); // 실패한 연결 정리
    expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1); // 다시 스캔하지 않음
    expect(service.lastConnectError).toBeNull();
  });

  it('두 번 모두 실패하면 실패 원인 코드를 남기고 실패 처리한다', async () => {
    mockManager.connectToDevice.mockRejectedValue(gattError());
    const service = new BleService();

    const assertion = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('연결 실패');
    await jest.advanceTimersByTimeAsync(3000);

    await assertion;
    expect(mockManager.connectToDevice).toHaveBeenCalledTimes(2);
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledTimes(2);
    expect(service.lastConnectError).toBe('E133');
    expect(service.isConnected()).toBe(false);
  });

  it('필요한 서비스가 없으면 NO_SERVICE 로 기록하고 연결을 정리한다', async () => {
    mockManager.connectToDevice.mockResolvedValue(makeDevice(false));
    const service = new BleService();

    const assertion = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('연결 실패');
    await jest.advanceTimersByTimeAsync(3000);

    await assertion;
    expect(service.lastConnectError).toBe('NO_SERVICE');
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalled();
  });

  it('스캔 중에 cancelConnect 하면 스캔을 멈추고 연결 시도를 실패 처리한다', async () => {
    mockManager.startDeviceScan.mockImplementation(() => undefined); // 아직 발견하지 못함
    const service = new BleService();

    const assertion = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('연결 취소');
    await jest.advanceTimersByTimeAsync(100);
    service.cancelConnect();

    await assertion;
    expect(mockManager.stopDeviceScan).toHaveBeenCalled();
    expect(service.lastConnectError).toBe('ABORTED');
    expect(mockManager.connectToDevice).not.toHaveBeenCalled();
  });

  it('GATT 연결 중에 cancelConnect 하면 연결을 취소하고 재시도하지 않는다', async () => {
    let rejectConnect: (e: any) => void = () => undefined;
    mockManager.connectToDevice.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectConnect = reject; })
    );
    mockManager.cancelDeviceConnection.mockImplementation(async () => {
      rejectConnect(gattError()); // 취소하면 진행 중이던 연결 시도가 끝난다
    });
    const service = new BleService();

    const assertion = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('연결 취소');
    await jest.advanceTimersByTimeAsync(100); // 기기 발견 -> 연결 시도 중
    service.cancelConnect();
    await jest.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(mockManager.connectToDevice).toHaveBeenCalledTimes(1); // 재시도 없음
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith('D1');
    expect(service.lastConnectError).toBe('ABORTED');
    expect(service.isConnected()).toBe(false);
  });

  it('취소한 뒤 다시 스캔하면 정상적으로 연결된다 (취소 상태가 남지 않는다)', async () => {
    mockManager.startDeviceScan.mockImplementationOnce(() => undefined);
    const service = new BleService();

    const first = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('연결 취소');
    service.cancelConnect();
    await first;

    mockManager.startDeviceScan.mockImplementation((_u: any, _o: any, cb: any) => {
      setTimeout(() => cb(null, { id: 'D1', name: 'unist_301201', rssi: -50 }), 10);
    });
    mockManager.connectToDevice.mockResolvedValue(makeDevice());
    const second = service.scanAndAutoConnect('unist_301201');
    await jest.advanceTimersByTimeAsync(2000);

    await expect(second).resolves.toBe(true);
  });

  it('기기를 찾지 못하면 SCAN_TIMEOUT 으로 기록한다', async () => {
    mockManager.startDeviceScan.mockImplementation(() => undefined); // 아무것도 발견하지 못함
    const service = new BleService();

    const assertion = expect(service.scanAndAutoConnect('unist_301201')).rejects.toThrow('찾을 수 없습니다');
    await jest.advanceTimersByTimeAsync(13000);

    await assertion;
    expect(service.lastConnectError).toBe('SCAN_TIMEOUT');
    expect(mockManager.connectToDevice).not.toHaveBeenCalled();
  });
});

describe('BleService 블루투스 사용 불가 이유 구분', () => {
  beforeEach(() => {
    Object.values(mockManager).forEach(fn => fn.mockReset());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['PoweredOn', 'NONE'],
    ['PoweredOff', 'POWERED_OFF'],
    ['Unauthorized', 'PERMISSION'],
    ['Unsupported', 'POWERED_OFF'],
  ])('블루투스 상태 %s 는 %s', async (state, expected) => {
    mockManager.state.mockResolvedValue(state);
    await expect(new BleService().getBluetoothIssue()).resolves.toBe(expected);
  });

  it('상태를 읽지 못하면 쓸 수 없는 것으로 본다 (기존 isBluetoothPoweredOn 과 같은 기준)', async () => {
    mockManager.state.mockRejectedValue(new Error('boom'));
    const service = new BleService();
    await expect(service.getBluetoothIssue()).resolves.toBe('POWERED_OFF');
    await expect(service.isBluetoothPoweredOn()).resolves.toBe(false);
  });

  it('initialize: 블루투스가 꺼져 있으면 POWERED_OFF 로 기록한다', async () => {
    mockManager.state.mockResolvedValue('PoweredOff');
    const service = new BleService();
    await expect(service.initialize()).resolves.toBe(false);
    expect(service.lastInitFailure).toBe('POWERED_OFF');
  });

  it('initialize: 앱 권한이 꺼져 있으면(iOS Unauthorized) PERMISSION 으로 기록한다', async () => {
    mockManager.state.mockResolvedValue('Unauthorized');
    const service = new BleService();
    await expect(service.initialize()).resolves.toBe(false);
    expect(service.lastInitFailure).toBe('PERMISSION');
  });

  it('initialize: 성공하면 이전 실패 이유가 지워진다', async () => {
    const service = new BleService();
    mockManager.state.mockResolvedValue('PoweredOff');
    await service.initialize();
    expect(service.lastInitFailure).toBe('POWERED_OFF');

    mockManager.state.mockResolvedValue('PoweredOn');
    await expect(service.initialize()).resolves.toBe(true);
    expect(service.lastInitFailure).toBeNull();
  });

  describe('안드로이드 권한 요청', () => {
    const SCAN = 'android.permission.BLUETOOTH_SCAN';
    const CONNECT = 'android.permission.BLUETOOTH_CONNECT';
    const LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

    const asAndroid = (version: number) => {
      jest.replaceProperty(Platform, 'OS', 'android');
      jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
      return {
        multiple: jest.spyOn(PermissionsAndroid, 'requestMultiple'),
        single: jest.spyOn(PermissionsAndroid, 'request'),
      };
    };

    it('Android 12 이상: 근처 기기 권한만 한 번에 요청하고 위치 권한은 요청하지 않는다', async () => {
      const { multiple, single } = asAndroid(34);
      multiple.mockResolvedValue({ [SCAN]: 'granted', [CONNECT]: 'granted' } as any);
      mockManager.state.mockResolvedValue('PoweredOn');
      const service = new BleService();

      await expect(service.initialize()).resolves.toBe(true);

      expect(multiple).toHaveBeenCalledTimes(1);
      expect(multiple).toHaveBeenCalledWith([SCAN, CONNECT]);
      expect(single).not.toHaveBeenCalled(); // 위치 권한 요청 없음
      expect(service.lastInitFailure).toBeNull();
    });

    it('Android 12 이상: 설명 창(rationale)을 쓰지 않는다', async () => {
      const { multiple } = asAndroid(34);
      multiple.mockResolvedValue({ [SCAN]: 'granted', [CONNECT]: 'granted' } as any);
      mockManager.state.mockResolvedValue('PoweredOn');

      await new BleService().initialize();

      expect(multiple.mock.calls[0]).toHaveLength(1); // 권한 목록만 전달
    });

    it.each([
      ['스캔만 거부', { [SCAN]: 'denied', [CONNECT]: 'granted' }],
      ['연결만 거부', { [SCAN]: 'granted', [CONNECT]: 'denied' }],
      ['다시 묻지 않음', { [SCAN]: 'never_ask_again', [CONNECT]: 'never_ask_again' }],
    ])('Android 12 이상: %s 이면 PERMISSION 으로 기록하고 상태 확인까지 가지 않는다', async (_name, result) => {
      const { multiple } = asAndroid(34);
      multiple.mockResolvedValue(result as any);
      const service = new BleService();

      await expect(service.initialize()).resolves.toBe(false);

      expect(service.lastInitFailure).toBe('PERMISSION');
      expect(mockManager.state).not.toHaveBeenCalled();
    });

    it('Android 11 이하: 위치 권한만 요청한다 (이 버전은 BLE 스캔에 위치 권한이 필요하다)', async () => {
      const { multiple, single } = asAndroid(30);
      single.mockResolvedValue('granted' as any);
      mockManager.state.mockResolvedValue('PoweredOn');

      await expect(new BleService().initialize()).resolves.toBe(true);

      expect(single).toHaveBeenCalledTimes(1);
      expect(single).toHaveBeenCalledWith(LOCATION);
      expect(multiple).not.toHaveBeenCalled();
    });

    it('Android 11 이하: 위치 권한을 거부하면 PERMISSION 으로 기록한다', async () => {
      const { single } = asAndroid(30);
      single.mockResolvedValue('denied' as any);
      const service = new BleService();

      await expect(service.initialize()).resolves.toBe(false);
      expect(service.lastInitFailure).toBe('PERMISSION');
    });
  });
});
