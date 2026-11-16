export type Payer = {
  id: string;
  name: string;
  people: number;
};

export type Expense = {
  id: string;
  payerId: string;
  description: string;
  amount: number;
  date: string;
};

export type SplitGroup = {
  id: string;
  name: string;
  people: number;
  payers: Payer[];
  expenses: Expense[];
  updatedAt: number;
};

export type Balance = {
  payer: Payer;
  paid: bigint;
  share: bigint;
  net: bigint;
};

export type Settlement = {
  total: bigint;
  averagePerPerson: bigint;
  balances: Balance[];
  transfers: { from: Payer; to: Payer; amount: bigint }[];
};

export const MAX_EXPENSE_PAISE = 99_999_999_999;
export const MAX_PEOPLE = 2_147_483_647;
const numberFormat = new Intl.NumberFormat('en-IN');
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function parsePaise(input: string): number | null {
  const value = input.trim().replaceAll(',', '');
  if (value.length > 15 || !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null;
  const [rupees, paise = ''] = value.split('.');
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_EXPENSE_PAISE ? amount : null;
}

export function money(paise: bigint | number): string {
  const amount = BigInt(paise);
  const absolute = amount < 0n ? -amount : amount;
  const fraction = absolute % 100n;
  const sign = amount < 0n ? '−' : '';
  const cents = fraction === 0n ? '' : '.' + fraction.toString().padStart(2, '0');
  return sign + '₹' + numberFormat.format(absolute / 100n) + cents;
}

export function amountInput(paise: number): string {
  const fraction = paise % 100;
  const whole = Math.floor(paise / 100).toString();
  if (fraction === 0) return whole;
  return whole + '.' + fraction.toString().padStart(2, '0').replace(/0$/, '');
}

export function peopleLabel(people: number): string {
  return people === 1 ? '1 person' : people + ' people';
}

export function payerLabel(payers: number): string {
  return payers === 1 ? '1 payer' : payers + ' payers';
}

export function dateLabel(date: string): string {
  return dateFormat.format(new Date(date + 'T12:00:00Z'));
}

export function today(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ].join('-');
}

export function countPeople(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  return validPeople(count) ? count : null;
}

function validPeople(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_PEOPLE;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validGroup(group: SplitGroup): boolean {
  const payerIds = new Set(group.payers.map(({ id }) => id));
  const names = new Set(group.payers.map(({ name }) => name.trim().toLowerCase()));
  return (
    group.id.length > 0 &&
    Number.isSafeInteger(group.updatedAt) &&
    group.name.trim().length > 0 &&
    validPeople(group.people) &&
    group.payers.length > 0 &&
    group.payers.every(({ id, name, people }) => id.length > 0 && name.trim().length > 0 && validPeople(people)) &&
    group.payers.reduce((sum, payer) => sum + payer.people, 0) === group.people &&
    payerIds.size === group.payers.length &&
    names.size === group.payers.length &&
    new Set(group.expenses.map(({ id }) => id)).size === group.expenses.length &&
    group.expenses.every(expense =>
      expense.id.length > 0 &&
      payerIds.has(expense.payerId) &&
      expense.description.trim().length > 0 &&
      Number.isInteger(expense.amount) &&
      expense.amount >= 1 &&
      expense.amount <= MAX_EXPENSE_PAISE &&
      validDate(expense.date),
    )
  );
}

export function totalSpent(expenses: Expense[]): bigint {
  return expenses.reduce((total, expense) => total + BigInt(expense.amount), 0n);
}

export function settle(group: SplitGroup): Settlement {
  if (!validGroup(group)) throw new Error('The group must account for everyone and have valid expenses.');
  const paidBy = new Map<string, bigint>();
  let total = 0n;
  for (const expense of group.expenses) {
    const amount = BigInt(expense.amount);
    paidBy.set(expense.payerId, (paidBy.get(expense.payerId) ?? 0n) + amount);
    total += amount;
  }

  const people = BigInt(group.people);
  const average = total / people;
  const remainder = total % people;
  const shares = group.payers.map(payer => {
    const fraction = remainder * BigInt(payer.people);
    return { payer, share: average * BigInt(payer.people) + fraction / people, remainder: fraction % people };
  });
  const extraPaise = Number(total - shares.reduce((sum, share) => sum + share.share, 0n));
  // Stable sort preserves the Android payer order when remainders tie.
  const roundedUp = new Set(
    [...shares].sort((a, b) => compare(b.remainder, a.remainder))
      .slice(0, extraPaise).map(({ payer }) => payer.id),
  );
  const balances = shares.map(({ payer, share }) => {
    const paid = paidBy.get(payer.id) ?? 0n;
    const rounded = share + (roundedUp.has(payer.id) ? 1n : 0n);
    return { payer, paid, share: rounded, net: paid - rounded };
  });
  return {
    total,
    averagePerPerson: average + (remainder * 2n >= people ? 1n : 0n),
    balances,
    transfers: transfersFor(balances),
  };
}

function compare(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function transfersFor(balances: Balance[]): Settlement['transfers'] {
  const debtors = balances.filter(({ net }) => net < 0n)
    .sort((a, b) => compare(a.net, b.net)).map(({ payer, net }) => ({ payer, amount: -net }));
  const creditors = balances.filter(({ net }) => net > 0n)
    .sort((a, b) => compare(b.net, a.net)).map(({ payer, net }) => ({ payer, amount: net }));
  const transfers: Settlement['transfers'] = [];
  let fromIndex = 0;
  let toIndex = 0;
  while (fromIndex < debtors.length && toIndex < creditors.length) {
    const from = debtors[fromIndex];
    const to = creditors[toIndex];
    const amount = from.amount < to.amount ? from.amount : to.amount;
    transfers.push({ from: from.payer, to: to.payer, amount });
    from.amount -= amount;
    to.amount -= amount;
    if (from.amount === 0n) fromIndex++;
    if (to.amount === 0n) toIndex++;
  }
  return transfers;
}

export function settlementMessage(group: SplitGroup, result: Settlement): string {
  const payments = result.transfers.length
    ? ['Payments to make', ...result.transfers.map(transfer =>
      transfer.from.name + ' pays ' + transfer.to.name + ' ' + money(transfer.amount))]
    : ['Everyone is settled.'];
  return [
    group.name,
    'Total shared spending  ' + money(result.total),
    peopleLabel(group.people) + ' · ' + payerLabel(group.payers.length),
    '',
    ...payments,
    '',
    'Balances',
    ...result.balances.flatMap(balance => [
      balance.payer.name + ' · ' + peopleLabel(balance.payer.people),
      'Paid ' + money(balance.paid) + ' · Share ' + money(balance.share),
    ]),
  ].join('\n');
}
