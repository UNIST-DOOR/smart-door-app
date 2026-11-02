import { Alert, Linking } from 'react-native';

// 스토어 열기 (Play 스토어 앱 우선, 불가 시 웹)
export const openStore = async () => {
  const pkg = 'com.smartdoormanager';
  const marketUrl = `market://details?id=${pkg}`;
  const webUrl = `https://play.google.com/store/apps/details?id=${pkg}`;
  try {
    const canOpen = await Linking.canOpenURL(marketUrl);
    if (canOpen) {
      await Linking.openURL(marketUrl);
    } else {
      await Linking.openURL(webUrl);
    }
  } catch {
    try { await Linking.openURL(webUrl); } catch {}
  }
};

// 서버가 426(upgrade_required)을 줬을 때의 업데이트 안내
export const showUpgradeAlert = () => {
  Alert.alert(
    '업데이트 필요',
    '사용할 수 없는 앱 버전입니다.\n스토어에서 업데이트 후 사용해 주세요.\n1.0.1이하 버전은 보안업데이트로 인하여 앱 삭제 후 재설치해주시길 바랍니다.',
    [
      { text: '취소', style: 'cancel' },
      { text: '스토어로 이동', onPress: openStore }
    ]
  );
};
