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
