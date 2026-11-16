import { describe, expect, it } from 'vitest';
import {
  MAX_EXPENSE_PAISE, money, parsePaise, settle, settlementMessage, validDate, validGroup,
  type Expense, type Payer, type Settlement, type SplitGroup,
} from '../src/split';
import { editGroup } from '../src/storage';

const payer = (name: string, people = 1): Payer => ({ id: name, name, people });
const bill = (payerId: string, amount: number, index = 1): Expense => ({
  id: 'bill-' + index,
  payerId,
  description: 'Expense ' + index,
  amount,
  date: '2026-11-16',
});
const group = (payers: Payer[], expenses: Expense[]): SplitGroup => ({
  id: 'trip',
  name: 'Trip',
  people: payers.reduce((sum, payer) => sum + payer.people, 0),
  payers,
  expenses,
  updatedAt: 0,
});

function verifyTransfers(result: Settlement) {
  expect(result.balances.reduce((sum, balance) => sum + balance.paid, 0n)).toBe(result.total);
  expect(result.balances.reduce((sum, balance) => sum + balance.share, 0n)).toBe(result.total);
  expect(result.transfers.every(item => item.from.id !== item.to.id && item.amount > 0n)).toBe(true);
  for (const balance of result.balances) {
    const pending = result.transfers.reduce((net, transfer) => {
      if (transfer.from.id === balance.payer.id) return net + transfer.amount;
      if (transfer.to.id === balance.payer.id) return net - transfer.amount;
      return net;
    }, balance.net);
    expect(pending).toBe(0n);
  }
}

describe('Android split behavior', () => {
  it('splits the eight-person, five-payer trip the same way', () => {
    const trip = group(
      [payer('Pranav', 2), payer('Ram', 2), payer('Shyam', 2), payer('X'), payer('Y')],
      [
        bill('Pranav', 200_000, 1), bill('Pranav', 100_000, 2),
        bill('Pranav', 100_000, 3), bill('Pranav', 100_000, 4),
        bill('Ram', 1_000_000, 5), bill('Shyam', 1_700_000, 6),
      ],
    );
    const result = settle(trip);
    expect(result.total).toBe(3_200_000n);
    expect(result.averagePerPerson).toBe(400_000n);
    expect(result.balances.find(({ payer }) => payer.name === 'Ram')).toMatchObject({ share: 800_000n, net: 200_000n });
    expect(settlementMessage(trip, result)).toContain('Total shared spending  ₹32,000');
    verifyTransfers(result);
  });

  it('rounds the largest fractional shares first', () => {
    const result = settle(group([payer('A', 2), payer('B')], [bill('A', 10_000)]));
    expect(result.balances.map(({ share }) => share)).toEqual([6_667n, 3_333n]);
    expect(result.transfers).toEqual([{ from: payer('B'), to: payer('A', 2), amount: 3_333n }]);
    verifyTransfers(result);
  });

  it('uses payer order to break a remainder tie', () => {
    const result = settle(group([payer('A'), payer('B')], [bill('B', 1)]));
    expect(result.balances.map(({ share }) => share)).toEqual([1n, 0n]);
    expect(result.transfers[0]).toEqual({ from: payer('A'), to: payer('B'), amount: 1n });
    verifyTransfers(result);
  });

  it('conserves paise and clears every balance across 250 groups', () => {
    let seed = 73941;
    function next(max: number) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    }
    for (let index = 0; index < 250; index++) {
      const payers = Array.from({ length: next(11) + 1 }, (_, item) => payer('P' + item, next(6) + 1));
      const expenses = Array.from({ length: next(26) }, (_, item) =>
        bill(payers[next(payers.length)].id, next(10_000_000) + 1, item));
      verifyTransfers(settle(group(payers, expenses)));
    }
  });

  it('keeps large totals and their formatting exact', () => {
    const result = settle(group(
      [payer('A', 2_147_483_646), payer('B')],
      [bill('A', MAX_EXPENSE_PAISE, 1), bill('B', MAX_EXPENSE_PAISE, 2)],
    ));
    expect(result.total).toBe(199_999_999_998n);
    expect(money(result.total)).toBe('₹1,99,99,99,999.98');
    verifyTransfers(result);
  });
});

describe('Validation', () => {
  it('parses rupees into whole paise', () => {
    expect(parsePaise('5,000.25')).toBe(500_025);
    expect(parsePaise('.50')).toBe(50);
    expect(parsePaise('999999999.99')).toBe(MAX_EXPENSE_PAISE);
    for (const value of ['-1', '1.234', '0', '1e3', '1000000000', '₹20']) {
      expect(parsePaise(value)).toBeNull();
    }
  });

  it('rejects duplicate names, missing payers and incomplete coverage', () => {
    const trip = group([payer('A', 2), payer('B')], []);
    expect(validGroup(trip)).toBe(true);
    expect(validGroup({ ...trip, people: 4 })).toBe(false);
    expect(validGroup({ ...trip, expenses: [bill('Unknown', 100)] })).toBe(false);
    expect(validGroup(group([payer('Ram'), { ...payer('X'), name: ' RAM ' }], []))).toBe(false);
  });

  it('checks payment dates without moving them across time zones', () => {
    expect(validDate('2024-02-29')).toBe(true);
    expect(validDate('2025-02-29')).toBe(false);
    expect(validDate('2026-11-31')).toBe(false);
  });

  it('rejects an edit based on an older group snapshot', () => {
    const trip = group([payer('A'), payer('B')], []);
    const changed = editGroup([trip], trip, current => ({ ...current, name: 'Dinner' }));
    expect(changed[0].name).toBe('Dinner');
    expect(changed[0].updatedAt).toBeGreaterThan(trip.updatedAt);
    expect(() => editGroup(changed, trip, () => null)).toThrow('another window');
  });
});
