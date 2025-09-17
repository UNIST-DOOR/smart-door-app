export interface BleDevice {
  id: string;
  name: string | null;
  rssi?: number;
}

export interface BleService {
  uuid: string;
  characteristics: BleCharacteristic[];
}

export interface BleCharacteristic {
  uuid: string;
  isReadable: boolean;
  isWritableWithoutResponse: boolean;
  isWritableWithResponse: boolean;
  isNotifiable: boolean;
}

export interface BleConnectionState {
  isConnected: boolean;
  device: BleDevice | null;
  isScanning: boolean;
  isServiceDiscovered: boolean;
}

export type BleError = {
  code: number;
  message: string;
}; 