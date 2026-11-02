import DoorService from '../src/services/door/DoorService';

const makeBle = (options: { failWrites?: boolean; connected?: boolean } = {}) => {
  const sent: number[] = [];
  const ble: any = {
    onDataReceived: undefined,
    isConnected: () => options.connected !== false,
    sendByteArray: jest.fn(async (bytes: number[]) => {
      if (options.failWrites) {
        return false;
      }
      sent.push(...bytes);
      return true;
    }),
    sendByte: jest.fn(async (byte: number) => {
      if (options.failWrites) {
        return false;
      }
      sent.push(byte);
      return true;
    }),
  };
  return { ble, sent };
};

describe('DoorService.sendPacket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('받은 바이트를 순서대로 그대로 쓰고 0x81 응답이면 OK', async () => {
    const { ble, sent } = makeBle();
    const service = new DoorService(ble);
    const packet = [0xcc, 0x01, 0x2f, 0xa5, 0x2f];

    const promise = service.sendPacket(packet);
    await jest.advanceTimersByTimeAsync(1000);
    ble.onDataReceived('CC 81 01 00');

    await expect(promise).resolves.toEqual({ result: 'OK', responseHex: 'CC810100' });
    expect(sent).toEqual(packet);
  });

  it('마지막 바이트를 쓰는 순간 응답이 와도 놓치지 않는다', async () => {
    const { ble, sent } = makeBle();
    const service = new DoorService(ble);
    const packet = [1, 2, 3];
    ble.sendByte.mockImplementation(async (byte: number) => {
      sent.push(byte);
      if (byte === 3) {
        ble.onDataReceived('CC 81 01'); // 마지막 바이트 직후 즉시 응답
      }
      return true;
    });

    const promise = service.sendPacket(packet);
    await jest.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toMatchObject({ result: 'OK' });
  });

  it('도어락이 0x80 으로 응답하면 DOOR_FAIL', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);

    const promise = service.sendPacket([1]);
    await jest.advanceTimersByTimeAsync(10);
    ble.onDataReceived('CC 80 01');

    await expect(promise).resolves.toEqual({ result: 'DOOR_FAIL', responseHex: 'CC8001' });
  });

  it('응답이 없으면 타임아웃 후 NO_RESPONSE (서명이 틀리면 모듈은 응답하지 않음)', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);

    const promise = service.sendPacket([1, 2], { responseTimeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(4000);
    let done = false;
    promise.then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);

    await jest.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toEqual({ result: 'NO_RESPONSE' });
  });

  it('쓰기가 계속 실패하면 재시도 후 SEND_FAIL', async () => {
    const { ble } = makeBle({ failWrites: true });
    const service = new DoorService(ble);

    const promise = service.sendPacket([1, 2, 3]);
    await jest.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toEqual({ result: 'SEND_FAIL' });
    expect(ble.sendByte).toHaveBeenCalledTimes(4); // 최초 1회 + 재시도 3회, 첫 바이트에서 중단
  });

  it('연결이 없으면 쓰지 않고 SEND_FAIL', async () => {
    const { ble } = makeBle({ connected: false });
    const service = new DoorService(ble);

    await expect(service.sendPacket([1])).resolves.toEqual({ result: 'SEND_FAIL' });
    expect(ble.sendByte).not.toHaveBeenCalled();
  });

  it('전송 중에 다시 호출하면 거부', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);

    const first = service.sendPacket([1, 2, 3]);
    await expect(service.sendPacket([9])).resolves.toEqual({ result: 'SEND_FAIL' });

    await jest.advanceTimersByTimeAsync(500);
    ble.onDataReceived('CC 81 01');
    await expect(first).resolves.toMatchObject({ result: 'OK' });
  });

  it('응답이 이전 요청의 것이면(대기 중이 아니면) 무시한다', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);
    expect(service).toBeDefined();
    expect(() => ble.onDataReceived('CC 81 01')).not.toThrow();
  });

  it('공동현관문 패킷은 CC 21 01 00.. 체크섬(0xEE) 10바이트', async () => {
    const { ble, sent } = makeBle();
    const service = new DoorService(ble);

    const promise = service.openEntrance();
    await jest.advanceTimersByTimeAsync(1000);
    ble.onDataReceived('CC 81 21');

    await expect(promise).resolves.toBe(true);
    expect(sent).toEqual([0xcc, 0x21, 0x01, 0, 0, 0, 0, 0, 0, 0xee]);
  });
});

describe('DoorService.sendPacket (한 번에 쓰기)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('패킷 전체를 한 번의 쓰기로 보내고 1바이트 쓰기는 쓰지 않는다', async () => {
    const { ble, sent } = makeBle();
    const service = new DoorService(ble);
    const packet = Array.from({ length: 54 }, (_, i) => i);

    const promise = service.sendPacket(packet, { bulk: true });
    await jest.advanceTimersByTimeAsync(10);
    ble.onDataReceived('CC 81 01');

    await expect(promise).resolves.toMatchObject({ result: 'OK' });
    expect(ble.sendByteArray).toHaveBeenCalledTimes(1);
    expect(ble.sendByteArray).toHaveBeenCalledWith(packet);
    expect(ble.sendByte).not.toHaveBeenCalled();
    expect(sent).toEqual(packet);
  });

  it('쓰기 직후 응답이 와도 놓치지 않는다', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);
    ble.sendByteArray.mockImplementation(async () => {
      ble.onDataReceived('CC 81 01');
      return true;
    });

    const promise = service.sendPacket([1, 2, 3], { bulk: true });
    await jest.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toMatchObject({ result: 'OK' });
  });

  it('한 번에 쓰기가 계속 실패하면 재시도 후 SEND_FAIL', async () => {
    const { ble } = makeBle({ failWrites: true });
    const service = new DoorService(ble);

    const promise = service.sendPacket([1, 2, 3], { bulk: true });
    await jest.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual({ result: 'SEND_FAIL' });
    expect(ble.sendByteArray).toHaveBeenCalledTimes(4); // 최초 1회 + 재시도 3회
  });

  it('bulk 가 아니면 기존처럼 1바이트씩 쓴다 (공동현관문 등)', async () => {
    const { ble } = makeBle();
    const service = new DoorService(ble);

    const promise = service.sendPacket([1, 2, 3]);
    await jest.advanceTimersByTimeAsync(500);
    ble.onDataReceived('CC 81 01');

    await expect(promise).resolves.toMatchObject({ result: 'OK' });
    expect(ble.sendByte).toHaveBeenCalledTimes(3);
    expect(ble.sendByteArray).not.toHaveBeenCalled();
  });
});
