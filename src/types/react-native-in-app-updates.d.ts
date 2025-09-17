declare module 'react-native-in-app-updates' {
  export enum IAUUpdateKind {
    FLEXIBLE = 0,
    IMMEDIATE = 1,
  }

  export type CheckUpdateResult = {
    shouldUpdate: boolean;
    other?: unknown;
  };

  export default class InAppUpdates {
    constructor(debug?: boolean);
    checkNeedsUpdate(): Promise<CheckUpdateResult>;
    startUpdate(options: { updateType: IAUUpdateKind }): Promise<void>;
  }
}


