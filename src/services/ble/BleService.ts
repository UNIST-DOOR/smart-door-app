import { BleManager, Device, Characteristic, ScanMode } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { BLE_UUIDS, APP_CONFIG } from '../../utils/constants';
import { BleDevice, BleConnectionState } from '../../types/ble';
import { isTargetDevice } from '../../utils/helpers';
import { bleErrorLog, perfLog } from '../../utils/perf';

// 문 열기 스캔은 저지연 모드로 한다 (기본 모드는 폰이 가끔씩만 스캔해서 기기를 찾는 시간이 들쭉날쭉했다). 안드로이드 전용 옵션.
const DOOR_SCAN_OPTIONS = { scanMode: ScanMode.LowLatency };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// 연결 실패 원인 코드 (예: E133). 서버 로그(stage)와 진단용으로 짧게 만든다.
const describeBleError = (error: any): string => {
  const code = error?.androidErrorCode ?? error?.errorCode;
  return code !== undefined && code !== null ? `E${code}` : 'E?';
};

class BleService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private commandCharacteristic: Characteristic | null = null;
  private notifyCharacteristic: Characteristic | null = null;
  
  // 마지막 연결 실패 원인 (예: E133, SCAN_TIMEOUT, NO_SERVICE). 서버 로그(stage)와 진단용
  public lastConnectError: string | null = null;

  // 진행 중인 스캔·연결을 취소하기 위한 상태 (서버가 거절했을 때 등)
  private abortRequested = false;
  private connectingDeviceId: string | null = null;
  private rejectPendingConnect: (() => void) | null = null;

  // 이벤트 콜백
  public onDeviceFound?: (device: BleDevice) => void;
  public onConnectionStateChange?: (state: BleConnectionState) => void;
  public onDataReceived?: (data: string) => void;
  public onError?: (error: string) => void;

  constructor() {
    this.manager = new BleManager();
  }

  /**
   * Android용 BLE 권한 요청
   */
  async requestBlePermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true; // iOS는 명시적인 BLE 권한이 필요하지 않음
    }

    try {
      // Android 12+ 새로운 권한들
      if (Platform.Version >= 31) {
        const bluetoothScanGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          {
            title: 'Bluetooth Scan Permission',
            message: 'BLE 스캔을 위해 블루투스 권한이 필요합니다.',
            buttonNegative: '취소',
            buttonPositive: '확인',
          }
        );

        const bluetoothConnectGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          {
            title: 'Bluetooth Connect Permission',
            message: 'BLE 연결을 위해 블루투스 권한이 필요합니다.',
            buttonNegative: '취소',
            buttonPositive: '확인',
          }
        );

        if (bluetoothScanGranted !== PermissionsAndroid.RESULTS.GRANTED ||
            bluetoothConnectGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          this.onError?.('블루투스 권한이 거부되었습니다');
          return false;
        }
      }

      // 위치 권한 (모든 Android 버전)
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'BLE 스캔을 위해 위치 권한이 필요합니다.',
          buttonNegative: '취소',
          buttonPositive: '확인',
        }
      );

      if (locationGranted !== PermissionsAndroid.RESULTS.GRANTED) {
        this.onError?.('위치 권한이 거부되었습니다. BLE 스캔을 위해 필요합니다.');
        return false;
      }

      return true;
    } catch (error) {
      this.onError?.(`권한 요청 실패: ${error}`);
      return false;
    }
  }

  /**
   * BLE 매니저 초기화 및 권한 확인
   */
  async initialize(): Promise<boolean> {
    try {
      // 권한 요청
      const permissionsGranted = await this.requestBlePermissions();
      if (!permissionsGranted) {
        return false;
      }

      const state = await this.manager.state();
      if (state !== 'PoweredOn') {
        this.onError?.('블루투스가 켜져 있지 않습니다');
        return false;
      }
      return true;
    } catch (error) {
      this.onError?.(`BLE 초기화 실패: ${error}`);
      return false;
    }
  }

  /**
   * 대상 기기 스캔 시작
   */
  async startScan(): Promise<void> {
    try {
      await this.manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          this.onError?.(`스캔 오류: ${error.message}`);
          return;
        }

        if (device && isTargetDevice(device.name, APP_CONFIG.DEVICE_NAME_PREFIX)) {
          const bleDevice: BleDevice = {
            id: device.id,
            name: device.name,
            rssi: device.rssi || undefined
          };
          this.onDeviceFound?.(bleDevice);
        }
      });

      // 타임아웃 후 스캔 자동 중지
      setTimeout(() => {
        this.stopScan();
      }, APP_CONFIG.SCAN_TIMEOUT);

    } catch (error) {
      this.onError?.(`스캔 시작 실패: ${error}`);
    }
  }

  /**
   * 자동 스캔 및 연결 (unist 기기 자동 찾기)
   * 문열림 버튼용 원클릭 기능
   */
  async scanAndAutoConnect(targetDeviceName?: string): Promise<boolean> {
    try {
      this.lastConnectError = null;
      this.abortRequested = false;
      this.rejectPendingConnect = null;

      // 이미 연결되어 있으면 성공 반환
      if (this.isConnected()) {
        return true;
      }

      // 기존 연결 정리
      if (this.connectedDevice) {
        this.connectedDevice = null;
        this.commandCharacteristic = null;
        this.notifyCharacteristic = null;
      }

      // 기존 스캔 중지 (안전장치)
      this.stopScan();

      return new Promise((resolve, reject) => {
        let found = false;
        
        // 기기명이 제공되지 않으면 에러
        if (!targetDeviceName) {
          reject(new Error('기기명이 제공되지 않았습니다'));
          return;
        }

        // 취소되면(서버 거절 등) 대기 중인 연결 약속을 바로 실패 처리한다
        this.rejectPendingConnect = () => reject(new Error('연결 취소'));

        // 스캔 시작
        perfLog('BLE 스캔 시작');
        this.manager.startDeviceScan(null, DOOR_SCAN_OPTIONS, async (error, device) => {
          if (error) {
            this.stopScan();
            this.lastConnectError = 'SCAN_ERR';
            bleErrorLog('스캔', error);
            this.onError?.(`❌ 스캔 오류: ${error.message}`);
            reject(new Error(`스캔 오류: ${error.message}`));
            return;
          }

          // 목표 기기 찾음 (정확 일치)
          if (device && device.name === targetDeviceName && !found && !this.abortRequested) {
            found = true;
            perfLog('기기 발견 (스캔 소요)');
            this.stopScan();
            
            try {
              // 자동 연결 시도
              const connected = await this.connectWithRetry(device.id);
              
              if (connected) {
                this.onConnectionStateChange?.({
                  isConnected: true,
                  device: {
                    id: device.id,
                    name: device.name,
                    rssi: device.rssi || undefined
                  },
                  isScanning: false,
                  isServiceDiscovered: true
                });
                resolve(true);
              } else {
                this.onError?.(`❌ 연결 실패: ${device.name}`);
                reject(new Error('연결 실패'));
              }
            } catch (connectError) {
              this.onError?.(`❌ 연결 예외: ${connectError}`);
              reject(new Error(`연결 오류: ${connectError}`));
            }
          }
        });

        // 타임아웃 설정 (12초)
        setTimeout(() => {
          if (!found) {
            this.stopScan();
            this.lastConnectError = 'SCAN_TIMEOUT';
            this.onError?.(`⏰ 기기를 찾을 수 없습니다: ${targetDeviceName}`);
            reject(new Error(`기기를 찾을 수 없습니다: ${targetDeviceName}`));
          }
        }, 12000);
      });

    } catch (error) {
      this.onError?.(`❌ 자동 연결 실패: ${error}`);
      return false;
    }
  }

  /**
   * 접두사(prefix)로 스캔하여 첫 매칭 기기에 자동 연결
   * 예) prefix = 'unistdoor_306' → 'unistdoor_30601', 'unistdoor_30602' 등
   */
  async scanAndAutoConnectByPrefix(prefix: string): Promise<boolean> {
    try {
      this.lastConnectError = null;
      this.abortRequested = false;
      this.rejectPendingConnect = null;

      if (this.isConnected()) {
        return true;
      }

      // 기존 연결 정리
      if (this.connectedDevice) {
        this.connectedDevice = null;
        this.commandCharacteristic = null;
        this.notifyCharacteristic = null;
      }

      // 기존 스캔 중지 (안전장치)
      this.stopScan();

      const normalizedPrefix = (prefix || '').toLowerCase();
      if (!normalizedPrefix) {
        this.onError?.('접두사가 제공되지 않았습니다');
        return false;
      }

      return new Promise((resolve, reject) => {
        let found = false;

        this.manager.startDeviceScan(null, DOOR_SCAN_OPTIONS, async (error, device) => {
          if (error) {
            this.stopScan();
            this.lastConnectError = 'SCAN_ERR';
            bleErrorLog('스캔', error);
            this.onError?.(`❌ 스캔 오류: ${error.message}`);
            reject(new Error(`스캔 오류: ${error.message}`));
            return;
          }

          const deviceName = device?.name || '';
          if (!found && deviceName.toLowerCase().startsWith(normalizedPrefix)) {
            found = true;
            this.stopScan();

            try {
              const connected = await this.connectWithRetry(device!.id);
              if (connected) {
                this.onConnectionStateChange?.({
                  isConnected: true,
                  device: {
                    id: device!.id,
                    name: device!.name || undefined,
                    rssi: device!.rssi || undefined
                  },
                  isScanning: false,
                  isServiceDiscovered: true
                });
                resolve(true);
              } else {
                this.onError?.(`❌ 연결 실패: ${deviceName}`);
                reject(new Error('연결 실패'));
              }
            } catch (connectError) {
              this.onError?.(`❌ 연결 예외: ${connectError}`);
              reject(new Error(`연결 오류: ${connectError}`));
            }
          }
        });

        // 타임아웃
        setTimeout(() => {
          if (!found) {
            this.stopScan();
            this.lastConnectError = 'SCAN_TIMEOUT';
            this.onError?.(`⏰ 접두사와 일치하는 기기를 찾지 못했습니다: ${prefix}`);
            reject(new Error(`기기를 찾지 못했습니다: ${prefix}`));
          }
        }, APP_CONFIG.SCAN_TIMEOUT);
      });

    } catch (error) {
      this.onError?.(`❌ 접두사 자동 연결 실패: ${error}`);
      return false;
    }
  }

  /**
   * 연결 시도가 실패하거나 중단됐을 때 폰/모듈에 남을 수 있는 GATT 연결을 확실히 닫는다.
   * (닫지 않으면 모듈이 이전 연결 때문에 다음 연결을 늦게 받거나 거부할 수 있다)
   */
  private async releaseConnection(deviceId: string): Promise<void> {
    try {
      await this.manager.cancelDeviceConnection(deviceId);
    } catch {
      // 이미 끊겨 있으면 오류가 나므로 무시한다
    }
    this.connectedDevice = null;
    this.commandCharacteristic = null;
    this.notifyCharacteristic = null;
  }

  /**
   * 진행 중인 스캔·연결을 취소한다. 서버가 문 열기를 거절했는데 스캔/연결이 남아 있으면 안 되기 때문이다.
   * 이미 연결이 끝났다면 아무 일도 하지 않으므로, 연결을 끊으려면 disconnect() 를 따로 호출한다.
   */
  cancelConnect(): void {
    this.abortRequested = true;
    this.lastConnectError = 'ABORTED';
    this.stopScan();
    if (this.connectingDeviceId) {
      // 진행 중인 GATT 연결 시도를 중단시킨다
      this.manager.cancelDeviceConnection(this.connectingDeviceId).catch(() => undefined);
    }
    this.rejectPendingConnect?.();
  }

  /**
   * 연결 실패 시 정리한 뒤 같은 기기에 자동으로 다시 연결한다. (재스캔 없이)
   * 안드로이드는 GATT 연결이 가끔 실패(예: 오류 133)하므로 학생이 다시 누르지 않도록 한 번 더 시도한다.
   * 취소(cancelConnect)가 요청되면 재시도하지 않고 연결을 정리한다.
   */
  private async connectWithRetry(deviceId: string): Promise<boolean> {
    const attempts = 1 + APP_CONFIG.CONNECT_RETRY_COUNT;
    this.connectingDeviceId = deviceId;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const connected = await this.connectToDevice(deviceId);

        if (this.abortRequested) {
          await this.releaseConnection(deviceId);
          this.lastConnectError = 'ABORTED';
          return false;
        }
        if (connected) {
          if (attempt > 1) {
            perfLog(`연결 재시도 성공 (${attempt}번째 시도)`);
          }
          this.lastConnectError = null; // 결국 연결됐으면 이전 실패 원인은 지운다
          return true;
        }

        perfLog(`연결 실패 (${attempt}/${attempts}번째 시도, ${this.lastConnectError ?? '원인 불명'})`);
        await this.releaseConnection(deviceId);
        if (attempt < attempts) {
          await sleep(APP_CONFIG.CONNECT_RETRY_DELAY);
          if (this.abortRequested) {
            this.lastConnectError = 'ABORTED';
            return false;
          }
        }
      }
      return false;
    } finally {
      this.connectingDeviceId = null;
    }
  }

  /**
   * BLE 스캔 중지
   */
  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  /**
   * 선택된 기기에 연결
   */
  async connectToDevice(deviceId: string): Promise<boolean> {
    try {
      // 기존 연결 정리
      if (this.connectedDevice) {
        this.connectedDevice = null;
        this.commandCharacteristic = null;
        this.notifyCharacteristic = null;
      }
      
      // 연결 시도
      const device = await this.manager.connectToDevice(deviceId, {
        timeout: 8000
      });
      
      this.connectedDevice = device;
      perfLog('GATT 연결 완료');

      // 서비스 및 특성 검색
      this.onError?.(`🔍 서비스 검색 중...`);
      await device.discoverAllServicesAndCharacteristics();
      perfLog('서비스·특성 검색 완료');
      
      // 실제 기기에서 MAIN_UUID 서비스 사용
      const services = await device.services();
      this.onError?.(`🔍 발견된 서비스 수: ${services.length}`);
      
      // MAIN_UUID 서비스 직접 찾기
      this.onError?.(`🔍 대상 서비스 UUID: ${BLE_UUIDS.MAIN_UUID}`);
      const service = services.find(s => s.uuid.toLowerCase() === BLE_UUIDS.MAIN_UUID.toLowerCase());
      
      if (!service) {
        this.onError?.(`❌ 서비스를 찾을 수 없습니다: ${BLE_UUIDS.MAIN_UUID}`);
        this.lastConnectError = 'NO_SERVICE';
        return false;
      }
      this.onError?.(`✅ 서비스 발견: ${service.uuid}`);

      // 특성 가져오기
      const characteristics = await service.characteristics();
      this.onError?.(`🔍 발견된 특성 수: ${characteristics.length}`);
      
      // MAIN_UUID 서비스: 별도의 명령/알림 특성 사용
      this.onError?.(`🔍 명령 특성 UUID: ${BLE_UUIDS.COMMAND_UUID}`);
      this.onError?.(`🔍 알림 특성 UUID: ${BLE_UUIDS.NOTIFY_UUID}`);
      
      const commandChar = characteristics.find(c => c.uuid.toLowerCase() === BLE_UUIDS.COMMAND_UUID.toLowerCase());
      const notifyChar = characteristics.find(c => c.uuid.toLowerCase() === BLE_UUIDS.NOTIFY_UUID.toLowerCase());
      
      if (!commandChar) {
        this.onError?.(`❌ 명령 특성을 찾을 수 없습니다: ${BLE_UUIDS.COMMAND_UUID}`);
        this.lastConnectError = 'NO_CHAR';
        return false;
      }
      this.onError?.(`✅ 명령 특성 발견: ${commandChar.uuid}`);
      
      // 전송용과 수신용 특성 설정
      this.commandCharacteristic = commandChar;
      this.notifyCharacteristic = notifyChar || commandChar; // 알림 특성이 없으면 명령 특성 사용
      
      if (notifyChar) {
        this.onError?.(`✅ 알림 특성 발견: ${notifyChar.uuid}`);
      } else {
        this.onError?.(`⚠️ 별도 알림 특성 없음, 명령 특성 사용: ${commandChar.uuid}`);
      }

      // 알림 활성화
      this.onError?.(`🔔 Notify 구독 시작...`);
      try {
        await this.notifyCharacteristic!.monitor((error, characteristic) => {
          if (error) {
            return;
          }
          
          if (characteristic?.value) {
            // 화면 표시를 위해 base64를 16진수 문자열로 변환
            const buffer = Buffer.from(characteristic.value, 'base64');
            const hexString = Array.from(buffer)
              .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
              .join(' ');
            
            // 디버깅: 수신된 응답 로그 (앱 화면에 표시)
            this.onError?.(`📡 수신응답: ${hexString}`);
            
            // 응답 코드 분석 로그
            if (buffer.length >= 3) {
              const header = buffer[0];
              const responseCode = buffer[1]; // 응답코드가 두 번째 바이트
              const command = buffer[2];      // 명령이 세 번째 바이트
              this.onError?.(`📋 헤더:0x${header.toString(16).toUpperCase()}, 응답:0x${responseCode.toString(16).toUpperCase()}, 명령:0x${command.toString(16).toUpperCase()}`);
              
              if (responseCode === 0x81) {
                this.onError?.(`🎉 성공응답(0x81) 수신 - 0.5초후 연결해제`);
              } else {
                this.onError?.(`⚠️ 예상외 응답코드: 0x${responseCode.toString(16).toUpperCase()}`);
              }
            }
            
            this.onDataReceived?.(hexString);
            
            // 0x81 응답코드 받으면 자동 연결 해제
            if (buffer.length > 1 && buffer[1] === 0x81) {
              setTimeout(() => {
                this.disconnect();
              }, 500); // 0.5초 후 연결 해제
            }
          }
        });
        this.onError?.(`✅ Notify 구독 성공!`);
        perfLog('알림(Notify) 구독 완료');
      } catch (notifyError) {
        this.onError?.(`❌ Notify 구독 실패: ${notifyError}`);
        // 알림 실패해도 연결은 성공으로 처리 (명령 전송은 가능)
      }

      this.onConnectionStateChange?.({
        isConnected: true,
        device: {
          id: device.id,
          name: device.name
        },
        isScanning: false,
        isServiceDiscovered: true
      });
      
      return true;

    } catch (error) {
      this.lastConnectError = describeBleError(error);
      bleErrorLog('연결', error);
      this.onError?.(`❌ 연결 실패: ${error}`);
      this.connectedDevice = null;
      this.commandCharacteristic = null;
      this.notifyCharacteristic = null;
      return false;
    }
  }

  /**
   * 기기에 바이트 배열 전송
   */
  async sendByteArray(bytes: number[]): Promise<boolean> {
    if (!this.commandCharacteristic || !this.connectedDevice) {
      this.onError?.('기기가 연결되지 않았거나 특성을 사용할 수 없습니다');
      return false;
    }

    try {
      const buffer = Buffer.from(bytes);
      const base64Data = buffer.toString('base64');
      
      await this.commandCharacteristic.writeWithoutResponse(base64Data);
      return true;
    } catch (error) {
      this.onError?.(`전송 실패: ${error}`);
      return false;
    }
  }

  /**
   * 연결된 기기에 MTU 를 요청하고 협상된 MTU 를 돌려준다. (Android 전용, 실패/미지원이면 null)
   * 패킷을 한 번에 쓰려면 MTU >= 패킷 길이 + 3 이어야 한다.
   */
  async requestMtu(mtu: number): Promise<number | null> {
    if (Platform.OS !== 'android' || !this.connectedDevice) {
      return null;
    }
    try {
      const updated = await this.connectedDevice.requestMTU(mtu);
      return typeof updated?.mtu === 'number' ? updated.mtu : null;
    } catch {
      return null;
    }
  }

  /**
   * 기기에 단일 바이트 전송 (기존 방식 유지)
   */
  async sendByte(byte: number): Promise<boolean> {
    return this.sendByteArray([byte]);
  }

  /**
   * 현재 기기에서 연결 해제
   */
  async disconnect(): Promise<void> {
    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
        this.connectedDevice = null;
        this.commandCharacteristic = null;
        this.notifyCharacteristic = null;
        
        this.onConnectionStateChange?.({
          isConnected: false,
          device: null,
          isScanning: false,
          isServiceDiscovered: false
        });
      } catch (error) {
        this.onError?.(`연결 해제 실패: ${error}`);
      }
    }
  }

  /**
   * 현재 기기에 연결되어 있는지 확인
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.commandCharacteristic !== null;
  }

  /**
   * 현재 블루투스 전원 상태 확인
   */
  async isBluetoothPoweredOn(): Promise<boolean> {
    try {
      const state = await this.manager.state();
      return state === 'PoweredOn';
    } catch {
      return false;
    }
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.stopScan();
    this.disconnect();
    this.manager.destroy();
  }
}

export default BleService; 