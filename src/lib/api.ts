import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import { authLog } from '../utils/perf';

let baseUrl: string = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
let authToken: string | null = null;
let authTokenExpiresOn: number | null = null; // 액세스 토큰 만료 시각 (epoch ms). 모르면 null

export const setBaseUrl = (url: string) => {
  baseUrl = url.replace(/\/$/, '');
};

// 초 단위로 온 값(1e11 미만)은 밀리초로 바꾼다. 알 수 없는 값은 null.
const toEpochMs = (value?: number | null): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1e11 ? value * 1000 : value;
};

/** 요청에 쓸 액세스 토큰을 설정한다. 만료 시각(expiresOn, epoch ms)을 함께 주면 만료 직전에 미리 갱신한다. */
export const setAuthToken = (token: string | null, expiresOn?: number | null) => {
  authToken = token;
  authTokenExpiresOn = token ? toEpochMs(expiresOn) : null;
};

// ── 토큰 자동 갱신 ─────────────────────────────────────────────
// 액세스 토큰은 약 1시간이면 만료된다. 만료된 토큰으로 요청하면 서버가 401 을 주고, 예전 앱은 이를 로그아웃으로 처리했다.
// 그래서 (1) 만료가 임박했으면 요청 전에 미리 갱신하고 (2) 서버가 토큰 오류를 주면 한 번 갱신해서 다시 보낸다.

export type RefreshedToken = { accessToken?: string; expiresOn?: number } | null | undefined;
type TokenRefresher = () => Promise<RefreshedToken>;

let tokenRefresher: TokenRefresher | null = null;

/** 토큰을 갱신하는 함수를 등록한다. (앱 시작 때 한 번) */
export const setTokenRefresher = (refresher: TokenRefresher | null) => {
  tokenRefresher = refresher;
};

const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000; // 만료 2분 전부터 미리 갱신
const REFRESH_TIMEOUT_MS = 10000; // 갱신이 이보다 오래 걸리면 포기하고 기존 토큰으로 진행
const REFRESH_COOLDOWN_MS = 30000; // 방금 갱신에 실패했으면(오프라인 등) 이 시간 동안은 미리 갱신하지 않는다

let refreshInFlight: Promise<boolean> | null = null;
let lastRefreshFailedAt = 0;

/**
 * 토큰을 갱신한다. 새 토큰을 쓸 수 있게 되면 true. 실패해도 예외를 던지지 않는다.
 * 동시에 여러 요청이 불러도 갱신은 한 번만 하고 결과를 함께 쓴다.
 */
const refreshAccessToken = (reason: string): Promise<boolean> => {
  const refresher = tokenRefresher;
  if (!refresher) {
    return Promise.resolve(false);
  }
  if (!refreshInFlight) {
    const tokenBefore = authToken;
    authLog(`토큰 갱신 시작 (${reason})`);
    refreshInFlight = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('token refresh timeout')), REFRESH_TIMEOUT_MS);
        });
        const refreshed = await Promise.race([refresher(), timeout]);
        if (!refreshed?.accessToken) {
          lastRefreshFailedAt = Date.now();
          authLog('토큰 갱신 실패: 새 토큰이 없음');
          return false;
        }
        if (authToken === null) {
          return false; // 갱신하는 동안 로그아웃했다. 로그인 상태를 되살리지 않는다.
        }
        if (authToken === tokenBefore) {
          setAuthToken(refreshed.accessToken, refreshed.expiresOn);
        } // 그 사이 다른 곳(로그인 등)에서 새 토큰으로 바꿨다면 그 토큰을 그대로 쓴다
        authLog('토큰 갱신 성공');
        return true;
      } catch (error: any) {
        lastRefreshFailedAt = Date.now();
        authLog(`토큰 갱신 실패: ${error?.message ?? error}`);
        return false;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
};

/** 만료가 임박했으면 요청 전에 미리 갱신한다. 갱신을 시도했으면 true. */
const refreshIfExpiring = async (): Promise<boolean> => {
  if (!authToken || authTokenExpiresOn === null || !tokenRefresher) {
    return false;
  }
  const now = Date.now();
  if (now < authTokenExpiresOn - REFRESH_BEFORE_EXPIRY_MS) {
    return false;
  }
  if (now - lastRefreshFailedAt < REFRESH_COOLDOWN_MS) {
    return false;
  }
  await refreshAccessToken('만료 임박');
  return true;
};

type ApiResult = { ok: boolean; status: number; data: any };

// 토큰 때문에 거절된 응답인가. 401 이거나, 예전 서버가 토큰 오류를 403({"detail": ...})으로 주던 경우.
// 문을 열 권한이 없는 403 은 {"error": "forbidden"} 형태라 해당하지 않는다.
export const isTokenFailure = (res: { status: number; data?: any }): boolean => {
  if (res.status === 401) {
    return true;
  }
  const data = res.data;
  return (
    res.status === 403 &&
    !!data &&
    typeof data === 'object' &&
    typeof data.detail === 'string' &&
    !('error' in data)
  );
};

/** 요청을 보내되, 토큰이 만료 직전이면 미리 갱신하고 토큰 오류가 오면 한 번 갱신해서 다시 보낸다. */
const withTokenRefresh = async (send: () => Promise<ApiResult>): Promise<ApiResult> => {
  const refreshedBefore = await refreshIfExpiring();
  const tokenUsed = authToken;
  const res = await send();
  if (!authToken || !tokenRefresher || !isTokenFailure(res)) {
    return res;
  }
  if (authToken !== tokenUsed) {
    return send(); // 이 요청이 가는 사이 다른 요청이 이미 토큰을 갱신했다
  }
  if (refreshedBefore) {
    return res; // 방금 갱신한 토큰도 거절당했다. 다시 갱신해도 소용없다
  }
  if (await refreshAccessToken('서버가 토큰 오류를 보냄')) {
    return send();
  }
  return res;
};

type FetchOptions = {
  headers?: Record<string, string>;
};

const buildHeaders = (extra?: Record<string, string>) => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  // 앱 플랫폼/빌드 헤더 추가(백엔드 최소 빌드 차단용)
  try {
    headers['X-App-Platform'] = Platform.OS;
    // versionCode와 자동 동기화: android/app/build.gradle defaultConfig.versionCode
    headers['X-App-Build'] = String(DeviceInfo.getBuildNumber());
  } catch {}
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (extra) Object.assign(headers, extra);
  return headers;
};

const readResponse = async (res: Response): Promise<ApiResult> => {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
};

export const apiGet = async (path: string, options?: FetchOptions) => {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  return withTokenRefresh(async () => readResponse(await fetch(url, { headers: buildHeaders(options?.headers) })));
};

export const apiPost = async (path: string, body: any, options?: FetchOptions) => {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  return withTokenRefresh(async () =>
    readResponse(
      await fetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(options?.headers),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    )
  );
};

export const getBaseUrl = () => baseUrl;
