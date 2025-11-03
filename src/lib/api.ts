import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';

let baseUrl: string = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
let authToken: string | null = null;

export const setBaseUrl = (url: string) => {
  baseUrl = url.replace(/\/$/, '');
};

export const setAuthToken = (token: string | null) => {
  authToken = token;
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

export const apiGet = async (path: string, options?: FetchOptions) => {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { headers: buildHeaders(options?.headers) });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
};

export const apiPost = async (path: string, body: any, options?: FetchOptions) => {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...buildHeaders(options?.headers),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: text };
  }
};

export const getBaseUrl = () => baseUrl;


