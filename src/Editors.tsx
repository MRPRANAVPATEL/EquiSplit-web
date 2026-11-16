import { CalendarDays, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import {
  amountInput, countPeople, MAX_PEOPLE, parsePaise, peopleLabel, today, validDate,
  type Expense, type Payer, type SplitGroup,
} from './split';

export type GroupDraft = Pick<SplitGroup, 'name' | 'people' | 'payers'>;
type PayerDraft = { id: string; name: string; people: string };

export function newId(): string {
  return crypto.randomUUID();
}

function emptyPayer(): PayerDraft {
  return { id: newId(), name: '', people: '1' };
}

function failureText(error: unknown): string {
  return error instanceof Error && !(error instanceof DOMException)
    ? error.message
    : 'Your changes could not be saved. Try again.';
}

export function GroupEditor({
  group, onClose, onSave, onDelete,
}: {
  group?: SplitGroup;
  onClose: () => void;
  onSave: (draft: GroupDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [people, setPeople] = useState(group?.people.toString() ?? '2');
  const [payers, setPayers] = useState<PayerDraft[]>(() =>
    group?.payers.map(payer => ({ ...payer, people: payer.people.toString() })) ?? [emptyPayer()],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const covered = payers.reduce((sum, payer) => sum + (countPeople(payer.people) ?? 0), 0);
  const total = countPeople(people);
  const eligible = total !== null && total === covered;

  function changePayer(id: string, patch: Partial<PayerDraft>) {
    setError('');
    setPayers(previous => previous.map(payer => payer.id === id ? { ...payer, ...patch } : payer));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const cleanName = name.trim();
    if (!cleanName) return setError('Enter a group name.');
    if (!total) return setError('Enter the total number of people.');
    const cleaned: Payer[] = payers.map(payer => ({
      id: payer.id, name: payer.name.trim(), people: countPeople(payer.people) ?? 0,
    }));
    if (cleaned.some(payer => !payer.name || !payer.people)) {
      return setError('Give each payer a name and at least one person to cover.');
    }
    if (new Set(cleaned.map(payer => payer.name.toLowerCase())).size !== cleaned.length) {
      return setError('Give each payer a different name.');
    }
    if (!eligible) return setError('The number of people covered must add up to the group total.');
    setBusy(true);
    try {
      await onSave({ name: cleanName, people: total, payers: cleaned });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete || busy) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={confirming ? 'Delete group?' : group ? 'Edit group' : 'New group'} onClose={onClose} busy={busy}>
      {confirming ? (
        <DeletePrompt
          description={'This will remove ' + group?.name + ' and all its expenses from this device.'}
          error={error}
          busy={busy}
          onBack={() => { setConfirming(false); setError(''); }}
          onDelete={remove}
          label="Delete group"
        />
      ) : (
        <form className="sheet-form" onSubmit={save} noValidate>
          <div className="sheet-body form-stack">
            <label className="field">
              <span>Group name</span>
              <input value={name} onChange={event => { setName(event.target.value); setError(''); }}
                maxLength={100} placeholder="e.g. Weekend trip" required />
            </label>
            <label className="field">
              <span>Total people</span>
              <input value={people} onChange={event => { setPeople(event.target.value); setError(''); }}
                inputMode="numeric" maxLength={10} pattern="[0-9]+" required />
              <small>Count everyone sharing the bills.</small>
            </label>
            <div className="payer-heading">
              <div><h3>Payers</h3><p>Each payer can cover themselves and others.</p></div>
              <span className={'coverage ' + (eligible ? 'coverage-ready' : '')} aria-live="polite">
                {covered} / {total ?? '—'} covered
              </span>
            </div>
            <div className="payer-inputs">
              {payers.map((payer, index) => {
                const hasExpenses = !!group?.expenses.some(expense => expense.payerId === payer.id);
                return (
                  <div className="payer-form" key={payer.id}>
                    <label className="field">
                      <span>{'Payer ' + (index + 1)}</span>
                      <input aria-label={'Payer ' + (index + 1) + ' name'} value={payer.name} maxLength={60}
                        placeholder="Name" onChange={event => changePayer(payer.id, { name: event.target.value })} required />
                    </label>
                    <div className="payer-controls">
                      <div className="count-control">
                        <span>People covered</span>
                        <div className="stepper">
                          <button type="button" aria-label={'Decrease people for payer ' + (index + 1)}
                            disabled={(countPeople(payer.people) ?? 1) <= 1}
                            onClick={() => changePayer(payer.id, { people: String((countPeople(payer.people) ?? 2) - 1) })}>
                            <Minus size={16} aria-hidden="true" />
                          </button>
                          <input aria-label={'People covered by payer ' + (index + 1)}
                            inputMode="numeric" maxLength={10} value={payer.people}
                            onChange={event => changePayer(payer.id, { people: event.target.value })} required />
                          <button type="button" aria-label={'Increase people for payer ' + (index + 1)}
                            disabled={countPeople(payer.people) === MAX_PEOPLE}
                            onClick={() => changePayer(payer.id, { people: String((countPeople(payer.people) ?? 0) + 1) })}>
                            <Plus size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {!hasExpenses && payers.length > 1 && (
                        <button className="icon-button danger-text" type="button" aria-label={'Remove payer ' + (index + 1)}
                          onClick={() => {
                            setPayers(previous => previous.filter(({ id }) => id !== payer.id));
                            setError('');
                          }}>
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      )}
                      {hasExpenses && <small className="muted">Has expenses</small>}
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="button secondary add-payer" type="button" onClick={() => {
              setPayers(previous => [...previous, emptyPayer()]);
              setError('');
            }}>
              <Plus size={17} aria-hidden="true" /> Add payer
            </button>
            {!!group?.expenses.length && <p className="muted form-note">Changing people covered updates the shares for saved expenses.</p>}
          </div>
          <FormFooter error={error}>
            {onDelete && (
              <button className="button quiet danger-text" type="button" disabled={busy}
                onClick={() => { setError(''); setConfirming(true); }}>Delete group</button>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : group ? 'Save group' : 'Create group'}
            </button>
          </FormFooter>
        </form>
      )}
    </Dialog>
  );
}

export function ExpenseEditor({
  group, expense, onClose, onSave, onDelete,
}: {
  group: SplitGroup;
  expense?: Expense;
  onClose: () => void;
  onSave: (expense: Expense) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(expense ? amountInput(expense.amount) : '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [payerId, setPayer] = useState(expense?.payerId ?? group.payers[0].id);
  const [date, setDate] = useState(expense?.date ?? today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const paise = parsePaise(amount);
    if (paise === null) return setError('Enter a positive amount with up to two decimal places.');
    if (!description.trim()) return setError('Enter a description for this expense.');
    if (!validDate(date)) return setError('Choose a valid payment date.');
    setBusy(true);
    setError('');
    try {
      await onSave({ id: expense?.id ?? newId(), payerId, description: description.trim(), amount: paise, date });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete || busy) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={confirming ? 'Delete expense?' : expense ? 'Edit expense' : 'Add expense'} onClose={onClose} busy={busy}>
      {confirming ? (
        <DeletePrompt description="The group’s balances will update." error={error} busy={busy}
          onBack={() => { setConfirming(false); setError(''); }} onDelete={remove} label="Delete expense" />
      ) : (
        <form className="sheet-form" onSubmit={save} noValidate>
          <div className="sheet-body form-stack">
            <label className="field amount-field">
              <span>Amount</span>
              <span className="amount-input">
                <span aria-hidden="true">₹</span>
                <input aria-label="Amount in rupees" inputMode="decimal" value={amount} placeholder="0.00"
                  maxLength={18} onChange={event => { setAmount(event.target.value); setError(''); }} required />
              </span>
            </label>
            <label className="field">
              <span>What was it for?</span>
              <input value={description} placeholder="e.g. Dinner" maxLength={120}
                onChange={event => { setDescription(event.target.value); setError(''); }} required />
            </label>
            <label className="field">
              <span>Paid by</span>
              <select value={payerId} onChange={event => setPayer(event.target.value)}>
                {group.payers.map(payer => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-icon"><CalendarDays size={16} aria-hidden="true" /> Payment date</span>
              <input type="date" value={date} required
                onChange={event => { setDate(event.target.value); setError(''); }} />
            </label>
            <p className="muted form-note">This expense is shared across all {peopleLabel(group.people)}.</p>
          </div>
          <FormFooter error={error}>
            {onDelete && (
              <button className="button quiet danger-text" type="button" disabled={busy}
                onClick={() => { setConfirming(true); setError(''); }}>Delete expense</button>
            )}
            <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button>
          </FormFooter>
        </form>
      )}
    </Dialog>
  );
}

function FormFooter({ error, children }: { error: string; children: ReactNode }) {
  return (
    <div className="sheet-footer">
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="sheet-actions">{children}</div>
    </div>
  );
}

function DeletePrompt({
  description, error, busy, onBack, onDelete, label,
}: {
  description: string;
  error: string;
  busy: boolean;
  onBack: () => void;
  onDelete: () => void;
  label: string;
}) {
  return (
    <>
      <div className="sheet-body"><p>{description}</p></div>
      <FormFooter error={error}>
        <button type="button" className="button secondary" disabled={busy} onClick={onBack}>Cancel</button>
        <button type="button" className="button danger" disabled={busy} onClick={onDelete}>{busy ? 'Deleting…' : label}</button>
      </FormFooter>
    </>
  );
}
