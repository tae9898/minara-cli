/**
 * Tests for perps flash command — round-trip market buy → hold → market sell.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  requireAuth: vi.fn(),
  loadConfig: () => ({ baseUrl: 'https://api.minara.ai', confirmBeforeTransaction: false }),
}));

vi.mock('../../src/api/perps.js', () => ({
  listSubAccounts: vi.fn(),
  getStrategies: vi.fn(),
  getAssetMeta: vi.fn().mockResolvedValue([]),
  placeOrders: vi.fn(),
  updateLeverage: vi.fn(),
}));

vi.mock('../../src/touchid.js', () => ({
  requireTouchId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  number: vi.fn(),
}));

vi.mock('ora', () => ({
  default: () => ({ start: () => ({ stop: () => { }, text: '' }) }),
}));

vi.mock('../../src/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils.js')>();
  return {
    ...actual,
    requireTransactionConfirmation: vi.fn().mockResolvedValue(undefined),
  };
});

import { requireAuth } from '../../src/config.js';
import * as perpsApi from '../../src/api/perps.js';

const mockRequireAuth = vi.mocked(requireAuth);
const mockListSubAccounts = vi.mocked(perpsApi.listSubAccounts);
const mockGetStrategies = vi.mocked(perpsApi.getStrategies);
const mockGetAssetMeta = vi.mocked(perpsApi.getAssetMeta);
const mockPlaceOrders = vi.mocked(perpsApi.placeOrders);
const mockUpdateLeverage = vi.mocked(perpsApi.updateLeverage);

const WALLET_DEFAULT = {
  _id: 'w-default', name: 'Main', address: '0xAAA', isDefault: true,
  equityValue: 1000, dispatchableValue: 500, totalUnrealizedPnl: 50, totalMarginUsed: 200,
  positions: [],
};

const ASSETS = [
  { name: 'ETH', markPx: 2000, szDecimals: 4, maxLeverage: 50 },
  { name: 'BTC', markPx: 50000, szDecimals: 5, maxLeverage: 40 },
];

function getCmd(name: string) {
  // lazy import so each test gets a fresh singleton (Commander caches state)
  return import('../../src/commands/perps.js').then((m) =>
    m.perpsCommand.commands.find((c) => c.name() === name || c.aliases().includes(name))!,
  );
}

function captureOutput() {
  const output: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  });
  return { output, logSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // Commander singletons retain flag state between parses
  mockRequireAuth.mockReturnValue({ accessToken: 'test-token' });
  mockListSubAccounts.mockResolvedValue({ success: true, data: [WALLET_DEFAULT] as never });
  mockGetStrategies.mockResolvedValue({ success: true, data: [] as never });
  mockGetAssetMeta.mockResolvedValue(ASSETS as never);
  mockUpdateLeverage.mockResolvedValue({ success: true } as never);
});

describe('perps flash command', () => {
  it('should market buy, then reduce-only market sell after the hold', async () => {
    mockPlaceOrders
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never)
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-u', '100', '-l', '10', '-d', '0', '--repeat', '1', '-y'], { from: 'user' });

    // Leverage set before entry
    expect(mockUpdateLeverage).toHaveBeenCalledWith('test-token', {
      symbol: 'ETH', isCross: true, leverage: 10, subAccountId: undefined,
    });

    // Leg 1: market buy IOC, 1% slippage, size = 100 / 2000
    expect(mockPlaceOrders).toHaveBeenNthCalledWith(1, 'test-token', {
      orders: [{
        a: 'ETH', b: true, p: '2020.0', s: '0.0500', r: false, t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      subAccountId: undefined,
    });

    // Leg 2: reduce-only market sell IOC, 1% slippage
    expect(mockPlaceOrders).toHaveBeenNthCalledWith(2, 'test-token', {
      orders: [{
        a: 'ETH', b: false, p: '1980.0', s: '0.0500', r: true, t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      subAccountId: undefined,
    });

    const full = output.join('\n');
    expect(full).toContain('Bought 0.0500 ETH');
    expect(full).toContain('flash trade complete');

    logSpy.mockRestore();
  });

  it('should support short side: sell entry, reduce-only buy-back exit', async () => {
    mockPlaceOrders
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never)
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-u', '100', '-l', '10', '-d', '0', '--side', 'short', '--repeat', '1', '-y'], { from: 'user' });

    // Leg 1: sell entry (not reduce-only), 1% slippage below mark
    expect(mockPlaceOrders).toHaveBeenNthCalledWith(1, 'test-token', {
      orders: [{
        a: 'ETH', b: false, p: '1980.0', s: '0.0500', r: false, t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      subAccountId: undefined,
    });

    // Leg 2: reduce-only buy-back, 1% slippage above mark
    expect(mockPlaceOrders).toHaveBeenNthCalledWith(2, 'test-token', {
      orders: [{
        a: 'ETH', b: true, p: '2020.0', s: '0.0500', r: true, t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
      subAccountId: undefined,
    });

    const full = output.join('\n');
    expect(full).toContain('SHORT');
    expect(full).toContain('Sold (short) 0.0500 ETH');
    expect(full).toContain('Bought back 0.0500 ETH');

    logSpy.mockRestore();
  });

  it('should not place orders in dry-run mode', async () => {
    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '--dry-run'], { from: 'user' });

    expect(mockPlaceOrders).not.toHaveBeenCalled();
    expect(mockUpdateLeverage).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('DRY RUN');

    logSpy.mockRestore();
  });

  it('should warn and suggest manual close when the sell leg fails', async () => {
    mockPlaceOrders
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never)
      .mockResolvedValueOnce({
        success: false, error: { code: 500, message: 'insufficient liquidity' },
      } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-d', '0', '-y'], { from: 'user' });

    const full = output.join('\n');
    expect(full).toContain('Exit failed');
    expect(full).toContain('insufficient liquidity');
    expect(full).toContain('minara perps close -s ETH');

    logSpy.mockRestore();
  });

  it('should be blocked while autopilot is active on the wallet', async () => {
    mockGetStrategies.mockResolvedValue({
      success: true,
      data: [{ _id: 'st-1', name: 'Bot', status: 'active', symbols: ['ETH'] }] as never,
    });

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-y'], { from: 'user' });

    const full = output.join('\n');
    expect(full).toContain('Autopilot "Bot" is ON');
    expect(mockPlaceOrders).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('should run multiple rounds with --repeat', async () => {
    mockPlaceOrders.mockResolvedValue({ success: true, data: { status: 'ok' } } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-d', '0', '--repeat', '2', '--pause', '0', '-y'], { from: 'user' });

    // 2 rounds × (buy + sell)
    expect(mockPlaceOrders).toHaveBeenCalledTimes(4);
    // Alternating buy/sell orders
    const calls = mockPlaceOrders.mock.calls;
    expect(calls[0][1].orders[0].b).toBe(true);
    expect(calls[1][1].orders[0].b).toBe(false);
    expect(calls[2][1].orders[0].b).toBe(true);
    expect(calls[3][1].orders[0].b).toBe(false);

    const full = output.join('\n');
    expect(full).toContain('Round 1/2');
    expect(full).toContain('Round 2/2');
    expect(full).toContain('Flash stopped after 2 completed round(s)');
    expect(full).toContain('cumulative');

    logSpy.mockRestore();
  });

  it('should stop the loop when a sell leg fails (position may stay open)', async () => {
    mockPlaceOrders
      .mockResolvedValueOnce({ success: true, data: { status: 'ok' } } as never)
      .mockResolvedValueOnce({ success: false, error: { code: 500, message: 'no liquidity' } } as never)
      .mockResolvedValue({ success: true, data: { status: 'ok' } } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    // Infinite repeat: must break out after the sell failure
    await cmd.parseAsync(['-s', 'ETH', '-d', '0', '--repeat', '0', '-y'], { from: 'user' });

    expect(mockPlaceOrders).toHaveBeenCalledTimes(2); // no further rounds started
    const full = output.join('\n');
    expect(full).toContain('Exit failed');
    expect(full).toContain('minara perps close -s ETH');
    expect(full).toContain('sell failure');

    logSpy.mockRestore();
  });

  it('should stop after 3 consecutive buy failures', async () => {
    mockPlaceOrders.mockResolvedValue({
      success: false, error: { code: 500, message: 'rejected' },
    } as never);

    const cmd = await getCmd('flash');
    const { output, logSpy } = captureOutput();

    await cmd.parseAsync(['-s', 'ETH', '-d', '0', '--repeat', '0', '--pause', '0', '-y'], { from: 'user' });

    expect(mockPlaceOrders).toHaveBeenCalledTimes(3); // 3 buy attempts, then halt
    expect(output.join('\n')).toContain('3 consecutive buy failures');

    logSpy.mockRestore();
  });

  it('should reject an invalid symbol', async () => {
    const cmd = await getCmd('flash');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    await expect(
      cmd.parseAsync(['-s', 'DOGE', '-y'], { from: 'user' }),
    ).rejects.toThrow('exit');

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
