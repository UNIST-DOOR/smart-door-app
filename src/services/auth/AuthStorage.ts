import EncryptedStorage from 'react-native-encrypted-storage';

export type StoredTokens = {
  accessToken?: string;
  refreshToken?: string;
  expiresOn?: number; // epoch ms
};

const STORAGE_KEY = 'SMART_DOOR_TOKENS_V1';

export const AuthStorage = {
  async setTokens(tokens: StoredTokens): Promise<void> {
    await EncryptedStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  },

  async getTokens(): Promise<StoredTokens | null> {
    const raw = await EncryptedStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async clearTokens(): Promise<void> {
    try { await EncryptedStorage.removeItem(STORAGE_KEY); } catch {}
  },
};


