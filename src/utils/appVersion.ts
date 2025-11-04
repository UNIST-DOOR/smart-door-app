import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, NativeModules } from 'react-native';

const INSTALL_FLAG_KEY = 'APP_INSTALLED_FLAG';

export const checkAndHandleReinstall = async (): Promise<boolean> => {
  try {
    const installFlag = await AsyncStorage.getItem(INSTALL_FLAG_KEY);
    
    if (!installFlag) {
      // iOS: MSAL 계정 삭제 (Keychain에 남은 계정 제거)
      if (Platform.OS === 'ios' && (NativeModules as any)?.MSALModule?.signOut) {
        try {
          await (NativeModules as any).MSALModule.signOut({});
        } catch {}
      }
      
      // EncryptedStorage 삭제
      await EncryptedStorage.clear();
      
      // 설치 플래그 저장
      await AsyncStorage.setItem(INSTALL_FLAG_KEY, 'installed');
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
};

