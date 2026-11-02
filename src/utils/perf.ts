/**
 * 문 열기 단계별 소요 시간 측정 (개발 모드 전용, 운영 빌드/테스트에서는 출력 안 함).
 * 직전 로그와의 시간 차이(+Xms)를 보여줘서 어느 단계가 오래 걸리는지 바로 알 수 있다.
 * 보는 법: adb logcat -s ReactNativeJS:V
 */
let last = 0;
let start = 0;

// jest 실행 중에는 출력하지 않는다
const enabled = () => __DEV__ && typeof jest === 'undefined';

export const perfReset = (stage: string): void => {
  last = Date.now();
  start = last;
  if (enabled()) {
    console.log(`[PERF] ---------- ${stage}`);
  }
};

export const perfLog = (stage: string): void => {
  const now = Date.now();
  const delta = last ? now - last : 0;
  last = now;
  if (enabled()) {
    console.log(`[PERF] +${delta}ms (T=${now - start}ms)  ${stage}`);
  }
};

/** BLE 오류 원문 (연결 실패 원인 진단용, 개발 모드 전용). 안드로이드 GATT 오류 코드(예: 133)를 함께 보여준다. */
export const bleErrorLog = (where: string, error: any): void => {
  if (enabled()) {
    console.log(
      `[BLE] ${where} 오류: ${error?.message ?? error} ` +
        `(errorCode=${error?.errorCode}, androidErrorCode=${error?.androidErrorCode}, ` +
        `attErrorCode=${error?.attErrorCode}, reason=${error?.reason})`
    );
  }
};
