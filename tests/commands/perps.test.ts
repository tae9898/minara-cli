/**
 * Integration tests for perps command — wallets, sweep, create-wallet,
 * rename-wallet, transfer, and autopilot wallet selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  requireAuth: vi.fn(),
  loadConfig: () => ({ baseUrl: 'https://api.minara.ai', confirmBeforeTransaction: false }),
}));

vi.mock('../../src/api/perps.js', () => ({
  listSubAccounts: vi.fn(),
  createSubAccount: vi.fn(),
  renameSubAccount: vi.fn(),
  getSubAccountSummary: vi.fn(),
  getAggregatedSummary: vi.fn(),
  sweepFunds: vi.fn(),
  transferFunds: vi.fn(),
  getStrategies: vi.fn(),
  getAccountSummary: vi.fn(),
  enableStrategy: vi.fn(),
  disableStrategy: vi.fn(),
  createStrategy: vi.fn(),
  getSupportedSymbols: vi.fn(),
  updateStrategy: vi.fn(),
  getPerformanceMetrics: vi.fn(),
  getRecords: vi.fn(),
  getMinEquityValue: vi.fn(),
  setMinEquityValue: vi.fn(),
  getPerpsAddress: vi.fn(),
  getAssetMeta: vi.fn().mockResolvedValue([]),
  getOpenOrders: vi.fn().mockResolvedValue([]),
  getUserFills: vi.fn().mockResolvedValue([]),
  getUserLeverage: vi.fn().mockResolvedValue([]),
  getUserPositions: vi.fn().mockResolvedValue([]),
  placeOrders: vi.fn(),
  cancelOrders: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn(),
  updateLeverage: vi.fn(),
  getFundRecords: vi.fn(),
  getDecisions: vi.fn(),
  claimRewards: vi.fn(),
  priceAnalysis: vi.fn(),
  getSubAccountRecords: vi.fn(),
  getSubAccountFills: vi.fn(),
  getSubAccountOpenOrders: vi.fn(),
  getCompletedTrades: vi.fn(),
  getTokenPrices: vi.fn(),
  getEquityHistory: vi.fn(),
  getPositions: vi.fn(),
  modifyOrders: vi.fn(),
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
import { select, input, confirm, number } from '@inquirer/prompts';

const mockRequireAuth = vi.mocked(requireAuth);
const mockListSubAccounts = vi.mocked(perpsApi.listSubAccounts);
const mockCreateSubAccount = vi.mocked(perpsApi.createSubAccount);
const mockRenameSubAccount = vi.mocked(perpsApi.renameSubAccount);
const mockGetSubAccountSummary = vi.mocked(perpsApi.getSubAccountSummary);
const mockGetAggregatedSummary = vi.mocked(perpsApi.getAggregatedSummary);
const mockSweepFunds = vi.mocked(perpsApi.sweepFunds);
const mockTransferFunds = vi.mocked(perpsApi.transferFunds);
const mockGetStrategies = vi.mocked(perpsApi.getStrategies);
const mockGetAccountSummary = vi.mocked(perpsApi.getAccountSummary);
const mockEnableStrategy = vi.mocked(perpsApi.enableStrategy);
const mockDisableStrategy = vi.mocked(perpsApi.disableStrategy);
const mockCreateStrategy = vi.mocked(perpsApi.createStrategy);
const mockGetSupportedSymbols = vi.mocked(perpsApi.getSupportedSymbols);
const mockGetAssetMeta = vi.mocked(perpsApi.getAssetMeta);
const mockUpdateLeverage = vi.mocked(perpsApi.updateLeverage);
const mockSelect = vi.mocked(select);
const mockInput = vi.mocked(input);
const mockConfirm = vi.mocked(confirm);
const mockNumber = vi.mocked(number);

function getCmd(name: string) {
  // lazy import so each test gets a fresh singleton (Commander caches state)
  return import('../../src/commands/perps.js').then((m) =>
    m.perpsCommand.commands.find((c) => c.name() === name || c.aliases().includes(name))!,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockReturnValue({ accessToken: 'test-token' });
  // Default: return HL-format summary for any sub-account so wallet pickers work
  mockGetSubAccountSummary.mockResolvedValue({
    success: true,
    data: {
      marginSummary: { accountValue: '100', totalNtlPos: '0', totalMarginUsed: '0' },
      withdrawable: '50',
      assetPositions: [],
    },
  });
});

const WALLET_DEFAULT = {
  _id: 'w-default', name: 'Main', address: '0xAAA', isDefault: true,
  equityValue: 1000, dispatchableValue: 500, totalUnrealizedPnl: 50, totalMarginUsed: 200,
  positions: [],
};
const WALLET_SUB1 = {
  _id: 'w-sub1', name: 'Bot-1', address: '0xBBB', isDefault: false,
  equityValue: 300, dispatchableValue: 100, totalUnrealizedPnl: -10, totalMarginUsed: 80,
  positions: [],
};

// ─── wallets ─────────────────────────────────────────────────────────────

describe('perps wallets command', () => {
  it('should list all wallets with equity and autopilot status', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat1', status: 'active', symbols: ['BTC'], subAccountId: 'w-default' },
      ] as never,
    });
    mockGetSubAccountSummary
      .mockResolvedValueOnce({
        success: true,
        data: { equityValue: 1000, dispatchableValue: 500, totalUnrealizedPnl: 50, totalMarginUsed: 200, positions: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { equityValue: 300, dispatchableValue: 100, totalUnrealizedPnl: -10, totalMarginUsed: 80, positions: [] },
      });
    mockGetAggregatedSummary.mockResolvedValue({
      success: true, data: { totalEquity: 1300, totalUnrealizedPnl: 40 },
    });

    const cmd = await getCmd('wallets');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    const full = output.join('\n');

    expect(full).toContain('Main');
    expect(full).toContain('Bot-1');
    expect(full).toContain('0xAAA');
    expect(full).toContain('0xBBB');
    expect(full).toContain('Aggregated');

    logSpy.mockRestore();
  });

  it('should show info when no wallets found', async () => {
    mockListSubAccounts.mockResolvedValue({ success: true, data: [] as never });
    mockGetStrategies.mockResolvedValue({ success: true, data: [] as never });

    const cmd = await getCmd('wallets');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    expect(output.join('\n')).toContain('No perps wallets');

    logSpy.mockRestore();
  });
});

// ─── create-wallet ──────────────────────────────────────────────────────

describe('perps create-wallet command', () => {
  it('should create a wallet with --name flag', async () => {
    mockCreateSubAccount.mockResolvedValue({
      success: true, data: { _id: 'new-w', name: 'Sniper', address: '0xCCC' } as never,
    });

    const cmd = await getCmd('create-wallet');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-n', 'Sniper'], { from: 'user' });

    expect(mockCreateSubAccount).toHaveBeenCalledWith('test-token', { name: 'Sniper' });
    expect(output.join('\n')).toContain('Sniper');
    expect(output.join('\n')).toContain('0xCCC');

    logSpy.mockRestore();
  });

  it('should handle API error gracefully', async () => {
    mockCreateSubAccount.mockResolvedValue({
      success: false, error: { code: 400, message: 'Name too long' },
    } as never);

    const cmd = await getCmd('create-wallet');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    await expect(
      cmd.parseAsync(['-n', 'ValidName'], { from: 'user' }),
    ).rejects.toThrow('exit');

    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── rename-wallet ──────────────────────────────────────────────────────

describe('perps rename-wallet command', () => {
  it('should rename a selected wallet', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockSelect.mockResolvedValueOnce(WALLET_SUB1 as never);
    mockInput.mockResolvedValueOnce('Renamed' as never);
    mockRenameSubAccount.mockResolvedValue({ success: true } as never);

    const cmd = await getCmd('rename-wallet');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });

    expect(mockRenameSubAccount).toHaveBeenCalledWith('test-token', {
      subAccountId: 'w-sub1',
      name: 'Renamed',
    });
    expect(output.join('\n')).toContain('Renamed');

    logSpy.mockRestore();
  });
});

// ─── sweep ──────────────────────────────────────────────────────────────

describe('perps sweep command', () => {
  it('should sweep funds from sub-wallet when autopilot is OFF', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat1', status: 'disabled', symbols: ['BTC'], subAccountId: 'w-sub1' },
      ] as never,
    });
    mockSelect.mockResolvedValueOnce(WALLET_SUB1 as never);
    mockSweepFunds.mockResolvedValue({ success: true, data: { txHash: '0xSweep' } });

    const cmd = await getCmd('sweep');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-y'], { from: 'user' });

    expect(mockSweepFunds).toHaveBeenCalledWith('test-token', { subAccountId: 'w-sub1' });
    expect(output.join('\n')).toContain('swept');

    logSpy.mockRestore();
  });

  it('should block sweep when autopilot is ON for the wallet', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat1', status: 'active', symbols: ['BTC'], subAccountId: 'w-sub1' },
      ] as never,
    });
    mockSelect.mockResolvedValueOnce(WALLET_SUB1 as never);

    const cmd = await getCmd('sweep');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-y'], { from: 'user' });

    expect(mockSweepFunds).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('is ON for');

    logSpy.mockRestore();
  });

  it('should show info when no sub-wallets exist', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    mockGetStrategies.mockResolvedValue({ success: true, data: [] as never });

    const cmd = await getCmd('sweep');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    expect(output.join('\n')).toContain('No sub-wallets');

    logSpy.mockRestore();
  });
});

// ─── transfer ───────────────────────────────────────────────────────────

describe('perps transfer command', () => {
  it('should transfer funds between wallets', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    // First select: from wallet, second: to wallet
    mockSelect.mockResolvedValueOnce(WALLET_DEFAULT as never);
    mockSelect.mockResolvedValueOnce(WALLET_SUB1 as never);
    const mockNumber = vi.mocked((await import('@inquirer/prompts')).number);
    mockNumber.mockResolvedValueOnce(50 as never);
    mockTransferFunds.mockResolvedValue({ success: true, data: { txHash: '0xTransfer' } });

    const cmd = await getCmd('transfer');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-y'], { from: 'user' });

    expect(mockTransferFunds).toHaveBeenCalledWith('test-token', {
      fromSubAccountId: undefined,  // default wallet → omitted
      toSubAccountId: 'w-sub1',
      amount: 50,
    });
    expect(output.join('\n')).toContain('Transferred');

    logSpy.mockRestore();
  });

  it('should require at least 2 wallets', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });

    const cmd = await getCmd('transfer');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    expect(output.join('\n')).toContain('at least 2 wallets');

    logSpy.mockRestore();
  });
});

// ─── autopilot (wallet selection) ────────────────────────────────────────

describe('perps autopilot command', () => {
  const setupAutopilotMocks = () => {
    mockGetSupportedSymbols.mockResolvedValue({
      success: true, data: ['BTC', 'ETH', 'SOL'] as never,
    });
    vi.mocked(perpsApi.getPerformanceMetrics).mockResolvedValue({
      success: true, data: { totalPnl: 100, winRate: 55 },
    });
    vi.mocked(perpsApi.getRecords).mockResolvedValue({
      success: true, data: [] as never,
    });
  };

  it('should let user select wallet and enable single strategy', async () => {
    setupAutopilotMocks();
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat1', name: 'Alpha', status: 'disabled', symbols: ['BTC'], subAccountId: 'w-default' },
      ] as never,
    });
    // 1st select: pick wallet
    // (single strategy auto-selected, dashboard shown)
    // 2nd select: enable, 3rd select: back
    mockSelect.mockResolvedValueOnce(WALLET_DEFAULT as never);
    mockSelect.mockResolvedValueOnce('on' as never);
    mockSelect.mockResolvedValueOnce('back' as never);
    mockEnableStrategy.mockResolvedValue({ success: true, data: {} });

    const cmd = await getCmd('autopilot');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });

    expect(mockEnableStrategy).toHaveBeenCalledWith('test-token', 'strat1');
    expect(output.join('\n')).toContain('ON');
    expect(output.join('\n')).toContain('Alpha');

    logSpy.mockRestore();
  });

  it('should disable autopilot for selected wallet', async () => {
    setupAutopilotMocks();
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat2', name: 'Beta', status: 'active', symbols: ['ETH'], subAccountId: 'w-sub1' },
      ] as never,
    });
    // 1st: pick wallet, (single strategy auto-selected, dashboard shown)
    // 2nd: off, confirm, 3rd: back
    mockSelect.mockResolvedValueOnce(WALLET_SUB1 as never);
    mockSelect.mockResolvedValueOnce('off' as never);
    mockConfirm.mockResolvedValueOnce(true as never);
    mockSelect.mockResolvedValueOnce('back' as never);
    mockDisableStrategy.mockResolvedValue({ success: true, data: {} });

    const cmd = await getCmd('autopilot');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });

    expect(mockDisableStrategy).toHaveBeenCalledWith('test-token', 'strat2');
    expect(output.join('\n')).toContain('OFF');

    logSpy.mockRestore();
  });

  it('should create strategy when wallet has none', async () => {
    setupAutopilotMocks();
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_SUB1] as never,
    });
    mockGetStrategies.mockResolvedValue({ success: true, data: [] as never });
    // No strategies → create/attach prompt: create, symbols input, config input
    mockSelect.mockResolvedValueOnce('create' as never);
    mockInput.mockResolvedValueOnce('BTC,ETH' as never);
    mockInput.mockResolvedValueOnce('{}' as never);
    mockCreateStrategy.mockResolvedValue({ success: true, data: {} });

    const cmd = await getCmd('autopilot');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

    await cmd.parseAsync([], { from: 'user' });

    expect(mockCreateStrategy).toHaveBeenCalledWith('test-token', {
      symbols: ['BTC', 'ETH'],
      subAccountId: 'w-sub1',
      strategyConfig: undefined,
    });

    logSpy.mockRestore();
  });

  it('should show all strategies and let user pick when multiple exist', async () => {
    setupAutopilotMocks();
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    mockGetStrategies.mockResolvedValue({
      success: true, data: [
        { _id: 'strat1', name: 'Alpha', status: 'active', symbols: ['BTC'], subAccountId: 'w-default' },
        { _id: 'strat2', name: 'Beta', status: 'disabled', symbols: ['ETH', 'SOL'] },
      ] as never,
    });
    const stratBeta = { active: false, strategyId: 'strat2', name: 'Beta', symbols: ['ETH', 'SOL'], raw: {} };
    // 1 wallet auto-selected → 2 strategies listed → pick strat2 → dashboard → back
    mockSelect.mockResolvedValueOnce(stratBeta as never);
    mockSelect.mockResolvedValueOnce('back' as never);

    const cmd = await getCmd('autopilot');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });

    const full = output.join('\n');
    expect(full).toContain('Alpha');
    expect(full).toContain('Beta');
    expect(full).toContain('strat2');

    logSpy.mockRestore();
  });
});

// ─── positions (multi-wallet) ───────────────────────────────────────────

describe('perps positions command (multi-wallet)', () => {
  it('should display positions per wallet', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetSubAccountSummary
      .mockResolvedValueOnce({
        success: true,
        data: { equityValue: 1000, totalUnrealizedPnl: 50, totalMarginUsed: 200, positions: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          equityValue: 300, totalUnrealizedPnl: -10, totalMarginUsed: 80,
          positions: [{ symbol: 'BTC', side: 'long', size: '0.1', entryPrice: '60000' }],
        },
      });
    mockGetAggregatedSummary.mockResolvedValue({
      success: true, data: { totalEquity: 1300, totalUnrealizedPnl: 40, totalMarginUsed: 280 },
    });

    const cmd = await getCmd('positions');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    const full = output.join('\n');

    expect(full).toContain('Main');
    expect(full).toContain('Bot-1');
    expect(full).toContain('Total positions');

    logSpy.mockRestore();
  });

  it('should fallback to legacy API when no wallets returned', async () => {
    mockListSubAccounts.mockResolvedValue({ success: true, data: [] as never });
    mockGetAccountSummary.mockResolvedValue({
      success: true,
      data: { equityValue: 500, totalUnrealizedPnl: 0, totalMarginUsed: 100, positions: [] },
    });

    const cmd = await getCmd('positions');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });
    const full = output.join('\n');

    expect(full).toContain('No open positions');
    expect(mockGetAccountSummary).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});

// ─── leverage ───────────────────────────────────────────────────────────

describe('perps leverage command', () => {
  const ASSETS = [
    { name: 'BTC', maxLeverage: 50, szDecimals: 5, markPx: 65000 },
    { name: 'ETH', maxLeverage: 50, szDecimals: 4, markPx: 3500 },
    { name: 'SOL', maxLeverage: 20, szDecimals: 3, markPx: 150 },
  ];

  beforeEach(() => {
    vi.resetModules();
    mockRequireAuth.mockReturnValue({ accessToken: 'test-token' });
    mockGetSubAccountSummary.mockResolvedValue({
      success: true,
      data: {
        marginSummary: { accountValue: '100', totalNtlPos: '0', totalMarginUsed: '0' },
        withdrawable: '50',
        assetPositions: [],
      },
    });
  });

  it('should set leverage non-interactively with --symbol and --leverage flags', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    mockGetAssetMeta.mockResolvedValue(ASSETS);
    mockUpdateLeverage.mockResolvedValue({ success: true, data: undefined });

    const cmd = await getCmd('leverage');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-s', 'ETH', '-l', '2'], { from: 'user' });

    expect(mockUpdateLeverage).toHaveBeenCalledWith('test-token', {
      symbol: 'ETH',
      isCross: true,
      leverage: 2,
      subAccountId: undefined,
    });
    expect(output.join('\n')).toContain('2x');
    expect(output.join('\n')).toContain('ETH');

    logSpy.mockRestore();
  });

  it('should set leverage on specific wallet with --wallet flag', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT, WALLET_SUB1] as never,
    });
    mockGetAssetMeta.mockResolvedValue(ASSETS);
    mockUpdateLeverage.mockResolvedValue({ success: true, data: undefined });

    const cmd = await getCmd('leverage');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync(['-w', 'Bot-1', '-s', 'SOL', '-l', '3'], { from: 'user' });

    // Note: wallet name lookup is case-insensitive
    expect(mockUpdateLeverage).toHaveBeenCalledWith('test-token', {
      symbol: 'SOL',
      isCross: true,
      leverage: 3,
      subAccountId: 'w-sub1',
    });
    expect(output.join('\n')).toContain('3x');
    expect(output.join('\n')).toContain('SOL');

    logSpy.mockRestore();
  });

  it('should reject invalid symbol in non-interactive mode', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    vi.mocked(perpsApi.getAssetMeta).mockResolvedValue(ASSETS);

    const cmd = await getCmd('leverage');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await cmd.parseAsync(['-s', 'INVALID', '-l', '2'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should reject leverage exceeding max for symbol', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    vi.mocked(perpsApi.getAssetMeta).mockResolvedValue(ASSETS);

    const cmd = await getCmd('leverage');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // SOL has maxLeverage: 20, so 100x should be rejected
    await cmd.parseAsync(['-s', 'SOL', '-l', '100'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should reject invalid leverage value', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    vi.mocked(perpsApi.getAssetMeta).mockResolvedValue(ASSETS);

    const cmd = await getCmd('leverage');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await cmd.parseAsync(['-s', 'BTC', '-l', 'invalid'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should reject leverage below 1', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    vi.mocked(perpsApi.getAssetMeta).mockResolvedValue(ASSETS);

    const cmd = await getCmd('leverage');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await cmd.parseAsync(['-s', 'BTC', '-l', '0'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should fall back to interactive mode when flags not provided', async () => {
    mockListSubAccounts.mockResolvedValue({
      success: true, data: [WALLET_DEFAULT] as never,
    });
    vi.mocked(perpsApi.getAssetMeta).mockResolvedValue(ASSETS);
    mockSelect.mockResolvedValueOnce('BTC' as never);
    mockNumber.mockResolvedValueOnce(10 as never);
    mockSelect.mockResolvedValueOnce(true as never);
    vi.mocked(perpsApi.updateLeverage).mockResolvedValue({ success: true, data: undefined });

    const cmd = await getCmd('leverage');
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });

    await cmd.parseAsync([], { from: 'user' });

    expect(mockSelect).toHaveBeenCalled();
    expect(mockNumber).toHaveBeenCalled();
    expect(output.join('\n')).toContain('10x');

    logSpy.mockRestore();
  });
});

// ─── mirror (net-exposure reconciliation) ────────────────────────────────

describe('perps mirror command (reconciliation)', () => {
  const mockPlaceOrders = vi.mocked(perpsApi.placeOrders);
  const mockGetUserPositions = vi.mocked(perpsApi.getUserPositions);
  const mockGetAccountSummary = vi.mocked(perpsApi.getAccountSummary);
  // External address used as a source (triggers getUserPositions path)
  const EXT_ADDR = '0x' + 'a'.repeat(40);
  const ASSETS = [
    { name: 'BTC', maxLeverage: 50, szDecimals: 5, markPx: 60000 },
  ];

  // The default wallet (WALLET_DEFAULT, isDefault:true) is resolved with
  // walletId=undefined, which makes fetchTargetState use getAccountSummary
  // instead of getSubAccountSummary. Tests that override target state must
  // therefore set mockGetAccountSummary, not mockGetSubAccountSummary.
  function setTargetState(assetPositions: { position: { coin: string; szi: string; entryPx?: string } }[], totalMarginUsed = '0', accountValue = '1000') {
    mockGetAccountSummary.mockResolvedValue({
      success: true,
      data: {
        marginSummary: { accountValue, totalNtlPos: '0', totalMarginUsed },
        withdrawable: '500',
        assetPositions,
      },
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue({ accessToken: 'test-token' });
    mockListSubAccounts.mockResolvedValue({ success: true, data: [WALLET_DEFAULT] as never });
    // Default target: empty, healthy margin
    setTargetState([]);
    mockGetAssetMeta.mockResolvedValue(ASSETS);
    mockGetUserPositions.mockResolvedValue([]);
    mockPlaceOrders.mockResolvedValue({ success: true, data: { raw_data: [] } });
    mockUpdateLeverage.mockResolvedValue({ success: true, data: undefined });
  });

  /**
   * Run mirror for a bounded number of polls, then exit via SIGINT.
   * `iterations` controls how many full polls complete before SIGINT fires.
   *
   * Commander v12 subcommands accumulate boolean flag values across parseAsync
   * calls on the same instance, so we manually clear `_optionValues` before
   * each parse to guarantee a clean option state.
   */
  async function runMirror(args: string[], iterations = 1): Promise<string> {
    let polls = 0;
    mockGetAssetMeta.mockImplementation(async () => {
      polls++;
      if (polls >= iterations) process.emit('SIGINT', 'SIGINT');
      return ASSETS;
    });

    const cmd = await getCmd('mirror');
    // Wipe Commander's cached option values so this test gets fresh defaults.
    (cmd as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};

    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => output.push(a.join(' ')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => output.push(a.join(' ')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await cmd.parseAsync(args, { from: 'user' });
      return output.join('\n');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  }

  it('should exit cleanly when user declines confirmation', async () => {
    mockConfirm.mockResolvedValueOnce(false as never);

    const cmd = await getCmd('mirror');
    (cmd as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmd.parseAsync(['-w', 'Main', '--source', EXT_ADDR], { from: 'user' });

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockPlaceOrders).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('dry-run: should detect source long and propose target short (no orders)', async () => {
    mockGetUserPositions.mockResolvedValue([
      { coin: 'BTC', szi: 0.5, entryPx: 60000, unrealizedPnl: 0 },
    ]);

    const full = await runMirror(
      ['--dry-run', '-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3'],
      1,
    );

    expect(full).toContain('BTC');
    expect(full).toContain('mismatch=');
    expect(full).toContain('DRY RUN');
    // No leverage set, no orders placed in dry-run
    expect(mockUpdateLeverage).not.toHaveBeenCalled();
    expect(mockPlaceOrders).not.toHaveBeenCalled();
  });

  it('dry-run: should mark REDUCE / reduce-only when closing an existing hedge', async () => {
    // Target already has BTC short (existing hedge)
    setTargetState(
      [{ position: { coin: 'BTC', szi: '-0.5', entryPx: '60000' } }],
      '200',
    );
    // Source has gone flat (closed long)
    mockGetUserPositions.mockResolvedValue([]);

    const full = await runMirror(
      ['--dry-run', '-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3'],
      1,
    );

    expect(full).toContain('REDUCE');
    expect(full).toContain('reduce-only');
    expect(mockPlaceOrders).not.toHaveBeenCalled();
  });

  it('should block new orders when target margin ratio exceeds ceiling', async () => {
    // marginRatio = 900/1000 = 0.9 > default 0.80
    setTargetState([], '900', '1000');
    mockGetUserPositions.mockResolvedValue([
      { coin: 'BTC', szi: 0.5, entryPx: 60000, unrealizedPnl: 0 },
    ]);

    const full = await runMirror(
      ['--dry-run', '-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3', '--margin-ceiling', '0.80'],
      1,
    );

    expect(full).toContain('exceeds ceiling');
    expect(mockPlaceOrders).not.toHaveBeenCalled();
  });

  it('should flatten + halt a coin after exceeding --max-retries', async () => {
    // Target has an existing BTC short that needs to be closed (source flat).
    // Mismatch tries to REDUCE the hedge but every order fails — after
    // max-retries, the existing target position must be flattened.
    setTargetState(
      [{ position: { coin: 'BTC', szi: '-0.5', entryPx: '60000' } }],
      '200',
    );
    mockGetUserPositions.mockResolvedValue([]);
    // Every order fails
    mockPlaceOrders.mockResolvedValue({
      success: false, error: { code: 500, message: 'Test failure' },
    });

    // max-retries=2: iter1 (fails=0→1), iter2 (fails=1→2), iter3 (2>=2 → flatten+halt)
    const full = await runMirror(
      ['-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3', '--max-retries', '2'],
      3,
    );

    expect(full).toContain('exceeded 2 consecutive failures');
    // 2 REDUCE attempts + 1 flatten attempt = 3 placeOrders calls
    expect(mockPlaceOrders.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Final flatten call should be reduce-only
    const lastCall = mockPlaceOrders.mock.calls.at(-1)?.[1];
    expect(lastCall.orders[0].r).toBe(true);
  }, 15000);

  it('baseline-only: should NOT hedge source positions present at startup', async () => {
    // Source has BTC position that does NOT change
    mockGetUserPositions.mockResolvedValue([
      { coin: 'BTC', szi: 0.5, entryPx: 60000, unrealizedPnl: 0 },
    ]);

    const full = await runMirror(
      ['--dry-run', '-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3', '--baseline-only'],
      1,
    );

    expect(full).toContain('Baseline set');
    // No mismatch to reconcile — baseline = current source positions
    expect(full).not.toMatch(/mismatch=/);
    expect(mockPlaceOrders).not.toHaveBeenCalled();
  });

  it('should attach SL trigger on new opens when --stop-loss is set', async () => {
    mockGetUserPositions.mockResolvedValue([
      { coin: 'BTC', szi: 0.5, entryPx: 60000, unrealizedPnl: 0 },
    ]);

    const full = await runMirror(
      ['--dry-run', '-y', '-w', 'Main', '--source', EXT_ADDR, '-i', '3', '--stop-loss', '5'],
      1,
    );

    // Dry-run log should mention the SL attachment on a brand-new open
    expect(full).toMatch(/SL 5%/);
  });
});
