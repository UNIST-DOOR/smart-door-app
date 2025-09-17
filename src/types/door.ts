export interface DoorCommand {
  code: number;
  name: string;
  description?: string;
}

export interface DoorStatus {
  isOpen: boolean;
  isLocked: boolean;
  batteryLevel?: number;
  lastActivity?: Date;
}

export interface CommandEntry {
  code: number;
  name: string;
}

export type LogLevel = 'info' | 'error' | 'warning' | 'success';

export interface LogMessage {
  id: string;
  message: string;
  level: LogLevel;
  timestamp: Date;
}

export interface SendQueueItem {
  byte: number;
  retryCount: number;
} 