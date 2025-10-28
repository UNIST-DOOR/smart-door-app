import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALL_FLAG_KEY = 'APP_INSTALLED_FLAG';

/**
 * 앱 재설치 감지 및 초기화
 * 
 * AsyncStorage는 앱 삭제 시 100% 삭제됨
 * EncryptedStorage(Keychain)는 앱 삭제 시 남을 수 있음
 * 
 * AsyncStorage에 설치 플래그가 없으면 재설치로 판단
 */
export const checkAndHandleReinstall = async (): Promise<boolean> => {
  try {
    const installFlag = await AsyncStorage.getItem(INSTALL_FLAG_KEY);
    
    if (!installFlag) {
      // 설치 플래그 없음 = 재설치 또는 첫 설치
      // EncryptedStorage 전체 초기화 (Keychain에 남아있을 수 있는 데이터 삭제)
      await EncryptedStorage.clear();
      // AsyncStorage에 설치 플래그 저장
      await AsyncStorage.setItem(INSTALL_FLAG_KEY, 'installed');
      return true; // 재설치됨
    }
    
    return false; // 정상 실행
  } catch (error) {
    console.error('Reinstall check error:', error);
    return false;
  }
};

