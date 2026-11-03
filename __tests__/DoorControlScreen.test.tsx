import React from 'react';
import { Alert, Linking, Modal, Platform, Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DoorControlScreen } from '../src/screens/control/DoorControlScreen';

const mockOpenRoomDoor = jest.fn();
const mockOpenEntranceDoor = jest.fn();
const mockBle: any = {
  getBluetoothIssue: jest.fn(),
  requestBlePermissions: jest.fn(),
  lastInitFailure: null,
};
let mockBleService: any = mockBle;

jest.mock('../src/hooks/useBLE', () => ({
  useBLE: () => ({ isConnected: false, bleService: mockBleService, isInitialized: true }),
}));
jest.mock('../src/hooks/useDoor', () => ({
  useDoor: () => ({
    isSending: false,
    openRoomDoor: mockOpenRoomDoor,
    openEntranceDoor: mockOpenEntranceDoor,
  }),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/lib/api', () => ({ apiPost: jest.fn(async () => ({ ok: true })) }));
jest.mock('../src/utils/store', () => ({ showUpgradeAlert: jest.fn() }));

const userInfo = {
  username: 'u',
  name: '학생',
  room: '201',
  building: '301',
  bleId: '301201',
  checkInDate: '20200101',
  checkInTime: '00:00',
  checkOutDate: '20991231',
  checkOutTime: '00:00',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

let renderer: ReactTestRenderer.ReactTestRenderer;
let alertSpy: jest.SpyInstance;

const render = async () => {
  await act(async () => {
    renderer = ReactTestRenderer.create(<DoorControlScreen onLogout={jest.fn()} userInfo={userInfo} />);
  });
};

const button = (label: string) => {
  const found = renderer.root
    .findAllByType(TouchableOpacity)
    .find(b => b.findAllByType(Text).some(t => String(t.props.children).includes(label)));
  if (!found) {
    throw new Error(`버튼을 찾을 수 없습니다: ${label}`);
  }
  return found;
};

const press = async (label: string, times = 1) => {
  await act(async () => {
    const target = button(label);
    for (let i = 0; i < times; i += 1) {
      target.props.onPress(); // 상태 갱신을 기다리지 않고 연달아 누르는 것을 흉내 낸다
    }
  });
};

describe('DoorControlScreen 문 열기 버튼', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockOpenRoomDoor.mockReset();
    mockOpenEntranceDoor.mockReset();
    mockBle.getBluetoothIssue.mockReset().mockResolvedValue('NONE');
    mockBle.requestBlePermissions.mockReset();
    mockBle.lastInitFailure = null;
    mockBleService = mockBle;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('연타해도 문 열기는 한 번만 시작하고, 끝나면 다시 누를 수 있다', async () => {
    const first = deferred<{ status: 'OK' }>();
    mockOpenRoomDoor.mockReturnValue(first.promise);
    await render();

    await press('도어락 열기', 2);
    expect(mockOpenRoomDoor).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ status: 'OK' });
    });
    mockOpenRoomDoor.mockResolvedValue({ status: 'OK' });
    await press('도어락 열기');
    expect(mockOpenRoomDoor).toHaveBeenCalledTimes(2);
  });

  it('문 열기가 진행되는 동안에는 공동현관문도 시작하지 않는다', async () => {
    mockOpenRoomDoor.mockReturnValue(new Promise(() => {}));
    await render();

    await press('도어락 열기');
    await press('공동현관문 열기');

    expect(mockOpenEntranceDoor).not.toHaveBeenCalled();
  });

  it('블루투스가 꺼져 있으면 줄바꿈이 있는 안내를 띄우고 시작하지 않는다', async () => {
    mockBle.getBluetoothIssue.mockResolvedValue('POWERED_OFF');
    await render();

    await press('도어락 열기');

    expect(alertSpy).toHaveBeenCalledWith('알림', '블루투스가 꺼져 있습니다.\n설정에서 블루투스를 켜주세요.');
    expect(mockOpenRoomDoor).not.toHaveBeenCalled();
  });

  it('앱 권한이 없으면 권한 안내와 설정 열기 버튼을 띄운다', async () => {
    mockBle.getBluetoothIssue.mockResolvedValue('PERMISSION');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render();

    await press('도어락 열기');

    expect(mockOpenRoomDoor).not.toHaveBeenCalled();
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('블루투스 권한이 필요합니다');
    expect(buttons.map((b: any) => b.text)).toEqual(['취소', '설정 열기']);
    buttons[1].onPress();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('문 열기 결과가 권한 없음이면 권한 안내를 띄운다 (도어락 연결 실패 문구가 아니다)', async () => {
    mockOpenRoomDoor.mockResolvedValue({ status: 'PERMISSION_DENIED' });
    await render();

    await press('도어락 열기');

    expect(alertSpy.mock.calls[0][0]).toBe('블루투스 권한이 필요합니다');
    expect(alertSpy).not.toHaveBeenCalledWith('실패', expect.stringContaining('도어락과 연결하지 못했습니다'));
  });

  it('도어락 연결 실패는 예전 문구 그대로 보여 준다', async () => {
    mockOpenRoomDoor.mockResolvedValue({ status: 'BLE_FAIL' });
    await render();

    await press('도어락 열기');

    expect(alertSpy).toHaveBeenCalledWith(
      '실패',
      '도어락과 연결하지 못했습니다.\n도어락 가까이에서 다시 시도해주세요.'
    );
  });

  it('안드로이드에서 권한을 한 번 거부했을 뿐이면 권한 창을 다시 띄우고, 허용하면 문을 연다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockBle.getBluetoothIssue.mockResolvedValueOnce('PERMISSION').mockResolvedValueOnce('NONE');
    mockBle.requestBlePermissions.mockResolvedValue(true);
    mockOpenRoomDoor.mockResolvedValue({ status: 'OK' });
    await render();

    await press('도어락 열기');

    expect(mockBle.requestBlePermissions).toHaveBeenCalledTimes(1);
    expect(mockOpenRoomDoor).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('안드로이드에서 다시 물어도 거부하면 설정 열기 안내를 띄운다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockBle.getBluetoothIssue.mockResolvedValue('PERMISSION');
    mockBle.requestBlePermissions.mockResolvedValue(false);
    await render();

    await press('도어락 열기');

    expect(mockOpenRoomDoor).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][0]).toBe('블루투스 권한이 필요합니다');
  });

  it('블루투스 준비 전에 누르면 "꺼져 있다"가 아니라 준비 중이라고 안내한다', async () => {
    mockBleService = null;
    await render();

    await press('도어락 열기');

    expect(alertSpy).toHaveBeenCalledWith('알림', '블루투스를 준비하는 중입니다.\n잠시 후 다시 시도해 주세요.');
    expect(mockOpenRoomDoor).not.toHaveBeenCalled();
  });

  it('예기치 않은 오류에는 오류 원문 대신 알아볼 수 있는 문구를 보여 준다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockOpenRoomDoor.mockRejectedValue(new Error('TypeError: undefined is not a function'));
    await render();

    await press('도어락 열기');

    expect(alertSpy).toHaveBeenCalledWith('오류', '문을 여는 중 문제가 발생했습니다.\n다시 시도해 주세요.');
  });

  it('이용 기간이 지난 계정은 블루투스 확인 전에 기존 문구로 막는다', async () => {
    mockBle.getBluetoothIssue.mockClear();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <DoorControlScreen onLogout={jest.fn()} userInfo={{ ...userInfo, checkOutDate: '20200101' }} />
      );
    });

    await press('도어락 열기');

    expect(alertSpy).toHaveBeenCalledWith('알림', '기숙사 이용 기간이 만료되었습니다.');
    expect(mockBle.getBluetoothIssue).not.toHaveBeenCalled();
    expect(mockOpenRoomDoor).not.toHaveBeenCalled();
  });
});

describe('DoorControlScreen 성공 알림', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockOpenRoomDoor.mockReset().mockResolvedValue({ status: 'OK' });
    mockBle.getBluetoothIssue.mockReset().mockResolvedValue('NONE');
    mockBleService = mockBle;
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const modalVisible = () => renderer.root.findByType(Modal).props.visible;
  const advance = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  it('성공 알림은 3초 뒤에 닫힌다', async () => {
    await render();
    await press('도어락 열기');
    expect(modalVisible()).toBe(true);

    await advance(2900);
    expect(modalVisible()).toBe(true);
    await advance(200);
    expect(modalVisible()).toBe(false);
  });

  it('3초 안에 다시 열면 이전 알림의 타이머가 새 알림을 일찍 닫지 않는다', async () => {
    await render();
    await press('도어락 열기');
    await advance(2500);
    await press('도어락 열기'); // 2.5초 시점에 다시 성공 → 5.5초에 닫혀야 한다

    await advance(1000); // 3.5초: 이전 타이머(3초)가 남아 있었다면 여기서 이미 닫혔을 것이다
    expect(modalVisible()).toBe(true);
    await advance(2100); // 5.6초
    expect(modalVisible()).toBe(false);
  });
});
