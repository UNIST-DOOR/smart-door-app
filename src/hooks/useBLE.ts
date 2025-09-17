import { useState, useEffect, useRef } from 'react';
import BleService from '../services/ble/BleService';
import { BleDevice, BleConnectionState } from '../types/ble';

export const useBLE = () => {
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [connectionState, setConnectionState] = useState<BleConnectionState>({
    isConnected: false,
    device: null,
    isScanning: false,
    isServiceDiscovered: false
  });
  const [receivedData, setReceivedData] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const bleServiceRef = useRef<BleService | null>(null);

  useEffect(() => {
    // Initialize BLE service
    const bleService = new BleService();
    bleServiceRef.current = bleService;

    // Setup event callbacks
    bleService.onDeviceFound = (device: BleDevice) => {
      setDevices(prev => {
        const exists = prev.find(d => d.id === device.id);
        if (!exists) {
          return [...prev, device];
        }
        return prev;
      });
    };

    bleService.onConnectionStateChange = (state: BleConnectionState) => {
      setConnectionState(state);
      if (state.isScanning) {
        setDevices([]); // Clear devices when starting new scan
      }
    };

    bleService.onDataReceived = (data: string) => {
      setReceivedData(prev => [...prev, data]);
    };

    bleService.onError = (errorMessage: string) => {
      setError(errorMessage);
    };

    // Initialize asynchronously
    const initializeBLE = async () => {
      try {
        await bleService.initialize();
        setIsInitialized(true); // 초기화 완료 표시
      } catch (err) {
        setError(`BLE 초기화 실패: ${err}`);
        setIsInitialized(false);
      }
    };
    
    initializeBLE();

    // Cleanup on unmount
    return () => {
      bleService.dispose();
    };
  }, []);

  const startScan = async () => {
    if (!bleServiceRef.current) return;
    
    setError(null);
    setConnectionState(prev => ({ ...prev, isScanning: true }));
    
    try {
      await bleServiceRef.current.startScan();
    } catch (err) {
      setError(`Scan failed: ${err}`);
      setConnectionState(prev => ({ ...prev, isScanning: false }));
    }
  };

  const stopScan = () => {
    if (!bleServiceRef.current) return;
    
    bleServiceRef.current.stopScan();
    setConnectionState(prev => ({ ...prev, isScanning: false }));
  };

  const connectToDevice = async (deviceId: string) => {
    if (!bleServiceRef.current) return false;
    
    setError(null);
    
    try {
      const success = await bleServiceRef.current.connectToDevice(deviceId);
      return success;
    } catch (err) {
      setError(`Connection failed: ${err}`);
      return false;
    }
  };

  const disconnect = async () => {
    if (!bleServiceRef.current) return;
    
    try {
      await bleServiceRef.current.disconnect();
    } catch (err) {
      setError(`Disconnect failed: ${err}`);
    }
  };

  const clearReceivedData = () => {
    setReceivedData([]);
  };

  const clearError = () => {
    setError(null);
  };

  return {
    // State
    devices,
    connectionState,
    receivedData,
    error,
    isInitialized,
    
    // Actions
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
    clearReceivedData,
    clearError,
    
    // Getters
    isConnected: connectionState.isConnected,
    isScanning: connectionState.isScanning,
    connectedDevice: connectionState.device,
    bleService: isInitialized ? bleServiceRef.current : null // 초기화 완료 후에만 반환
  };
}; 