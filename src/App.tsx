import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CloudOff, Download, HardDrive,
  Pencil, Plus, ReceiptText, Share2, Smartphone, UsersRound, Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Dialog } from './Dialog';
import { ExpenseEditor, GroupEditor, newId, type GroupDraft } from './Editors';
import {
  dateLabel, money, payerLabel, peopleLabel, settle, settlementMessage, totalSpent,
  type Balance, type Expense, type Settlement, type SplitGroup,
} from './split';
import { changeGroups, editGroup, readGroups } from './storage';

type Route = { groupId: string | null; tab: 'expenses' | 'settle' };
type Overlay =
  | { kind: 'group'; group?: SplitGroup }
  | { kind: 'expense'; group: SplitGroup; expense?: Expense }
  | { kind: 'install' }
  | { kind: 'copy'; text: string };

interface InstallPrompt extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function parseRoute(): Route {
  const match = /^#group\/([\w-]+)(?:\/(expenses|settle))?$/.exec(location.hash);
  return { groupId: match?.[1] ?? null, tab: match?.[2] === 'settle' ? 'settle' : 'expenses' };
}

function groupHref(id: string, tab: Route['tab'] = 'expenses'): string {
  return '#group/' + id + '/' + tab;
}

function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function useSavedGroups() {
  const [groups, setGroups] = useState<SplitGroup[] | null>(null);
  const [readError, setReadError] = useState(false);
  const readVersion = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const reload = useCallback(async () => {
    const version = ++readVersion.current;
    setReadError(false);
    try {
      const saved = await readGroups();
      if (version === readVersion.current) setGroups(saved);
    } catch {
      if (version === readVersion.current) setReadError(true);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void reload();
    refresh();
    window.addEventListener('focus', refresh);
    if (typeof BroadcastChannel === 'function') {
      channel.current = new BroadcastChannel('equisplit-updates');
      channel.current.addEventListener('message', refresh);
    }
    return () => {
      readVersion.current++;
      window.removeEventListener('focus', refresh);
      channel.current?.close();
      channel.current = null;
    };
  }, [reload]);

  async function change(mutate: (groups: SplitGroup[]) => SplitGroup[]) {
    const saved = await changeGroups(mutate);
    readVersion.current++;
    setReadError(false);
    setGroups(saved);
    channel.current?.postMessage('groups-changed');
  }

  return { groups, readError, reload, change };
}

export default function App() {
  const { groups, readError, reload, change } = useSavedGroups();
  const [route, setRoute] = useState(parseRoute);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(isInstalled);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  useEffect(() => {
    const changeRoute = () => {
      setRoute(parseRoute());
      setOverlay(null);
    };
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const finishInstall = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setOverlay(current => current?.kind === 'install' ? null : current);
    };
    window.addEventListener('hashchange', changeRoute);
    window.addEventListener('beforeinstallprompt', offerInstall);
    window.addEventListener('appinstalled', finishInstall);
    return () => {
      window.removeEventListener('hashchange', changeRoute);
      window.removeEventListener('beforeinstallprompt', offerInstall);
      window.removeEventListener('appinstalled', finishInstall);
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.groupId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function announce(text: string) {
    setNotice({ text });
  }

  function closeOverlay() {
    setOverlay(null);
  }

  async function saveGroup(draft: GroupDraft, group?: SplitGroup) {
    if (group) {
      await change(groups => editGroup(groups, group, current => ({ ...current, ...draft })));
    } else {
      const newGroup = { ...draft, id: newId(), expenses: [], updatedAt: Date.now() };
      await change(groups => [...groups, newGroup]);
      location.hash = groupHref(newGroup.id);
    }
    closeOverlay();
    announce(group ? 'Group updated.' : 'Group created.');
  }

  async function deleteGroup(group: SplitGroup) {
    await change(groups => editGroup(groups, group, () => null));
    location.hash = '#groups';
    closeOverlay();
    announce('Group deleted.');
  }

  async function saveExpense(group: SplitGroup, expense: Expense, editing: boolean) {
    await change(groups => editGroup(groups, group, current => ({
      ...current,
      expenses: editing
        ? current.expenses.map(item => item.id === expense.id ? expense : item)
        : [...current.expenses, expense],
    })));
    closeOverlay();
    announce(editing ? 'Expense updated.' : 'Expense added.');
  }

  async function deleteExpense(group: SplitGroup, expense: Expense) {
    await change(groups => editGroup(groups, group, current => ({
      ...current, expenses: current.expenses.filter(item => item.id !== expense.id),
    })));
    closeOverlay();
    announce('Expense deleted.');
  }

  async function share(group: SplitGroup, result: Settlement) {
    const text = settlementMessage(group, result);
    if (navigator.share) {
      try {
        await navigator.share({ title: group.name + ' · EquiSplit', text });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      announce('Settlement copied.');
    } catch {
      setOverlay({ kind: 'copy', text });
    }
  }

  async function requestInstall() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      if ((await installPrompt.userChoice).outcome === 'accepted') {
        setInstalled(true);
        closeOverlay();
      }
    } catch {
      // The manual Home Screen instructions remain available in the dialog.
    } finally {
      setInstallPrompt(null);
    }
  }

  const group = groups?.find(item => item.id === route.groupId);
  const cachedOffline = offlineReady || !!navigator.serviceWorker?.controller;
  const selectedOverlay = overlay;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link" onClick={event => {
        event.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>Skip to main content</a>
      <header className="app-header">
        <div className="frame app-header-inner">
          <a href="#groups" aria-label="EquiSplit groups" className="brand">
            <img src="/icons/icon-192.png" alt="" width="38" height="38" /> EquiSplit
          </a>
          {!installed && (
            <button className="button install-button" onClick={() => setOverlay({ kind: 'install' })}>
              <Download size={16} aria-hidden="true" /> Install
            </button>
          )}
        </div>
      </header>

      <main id="main-content" className="frame main" tabIndex={-1}>
        {needRefresh && !overlay && (
          <div className="update-banner">
            <span>A new version is ready.</span>
            <button className="button secondary" onClick={() => void updateServiceWorker(true)}>Reload app</button>
          </div>
        )}
        {readError ? (
          <section className="empty-panel" role="alert">
            <h1>Saved groups couldn’t be opened</h1>
            <p>Make sure this browser can store site data, then try again.</p>
            <button className="button primary" onClick={() => void reload()}>Try again</button>
          </section>
        ) : groups === null ? (
          <p className="loading" role="status">Loading your groups…</p>
        ) : group ? (
          <GroupPage
            group={group}
            tab={route.tab}
            onEditGroup={() => setOverlay({ kind: 'group', group })}
            onExpense={expense => setOverlay({ kind: 'expense', group, expense })}
            onShare={result => void share(group, result)}
          />
        ) : route.groupId ? (
          <section className="empty-panel">
            <h1>Group unavailable</h1>
            <p>Groups are saved in the browser or Home Screen app where you added them.</p>
            <a className="button primary" href="#groups">Back to groups</a>
          </section>
        ) : (
          <GroupsPage groups={groups} onNew={() => setOverlay({ kind: 'group' })} />
        )}
      </main>

      <footer className="frame app-footer">
        <HardDrive size={15} aria-hidden="true" /> Groups and expenses are saved on this device.
      </footer>

      {selectedOverlay?.kind === 'group' && (
        <GroupEditor
          key={selectedOverlay.group?.id ?? 'new-group'}
          group={selectedOverlay.group}
          onClose={closeOverlay}
          onSave={draft => saveGroup(draft, selectedOverlay.group)}
          onDelete={selectedOverlay.group ? () => deleteGroup(selectedOverlay.group!) : undefined}
        />
      )}
      {selectedOverlay?.kind === 'expense' && (
        <ExpenseEditor
          key={selectedOverlay.expense?.id ?? 'new-expense'}
          group={selectedOverlay.group}
          expense={selectedOverlay.expense}
          onClose={closeOverlay}
          onSave={expense => saveExpense(selectedOverlay.group, expense, !!selectedOverlay.expense)}
          onDelete={selectedOverlay.expense ? () => deleteExpense(selectedOverlay.group, selectedOverlay.expense!) : undefined}
        />
      )}
      {selectedOverlay?.kind === 'install' && (
        <InstallDialog onClose={closeOverlay} ready={cachedOffline} installPrompt={!!installPrompt}
          onInstall={() => void requestInstall()} />
      )}
      {selectedOverlay?.kind === 'copy' && (
        <Dialog title="Copy settlement" onClose={closeOverlay}>
          <div className="sheet-body form-stack">
            <label className="field">
              <span>Select and copy the summary.</span>
              <textarea readOnly rows={9} value={selectedOverlay.text} onFocus={event => event.target.select()} />
            </label>
          </div>
        </Dialog>
      )}
      <div className="toast-area" aria-live="polite" role="status">
        {notice && <div className="toast"><Check size={17} aria-hidden="true" /> {notice.text}</div>}
      </div>
    </div>
  );
}

function GroupsPage({ groups, onNew }: { groups: SplitGroup[]; onNew: () => void }) {
  if (groups.length === 0) {
    return (
      <section className="welcome" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <h1 id="welcome-title">Split shared<br className="welcome-break" /> expenses.</h1>
          <p>Create a group, record who paid, and see how to settle up.</p>
          <button className="button lime" onClick={onNew}><Plus size={19} aria-hidden="true" /> New group</button>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <span className="visual-orbit orbit-one" />
          <span className="visual-orbit orbit-two" />
          <div className="receipt-paper">
            <Wallet size={26} />
            <div className="paper-line wide" /><div className="paper-line short" /><div className="paper-dash" />
            <div className="paper-people"><span /><span /><span /></div>
          </div>
          <div className="receipt-check"><Check size={29} strokeWidth={2.6} /></div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="page-heading">
        <h1>Your groups</h1>
        <button className="button primary" onClick={onNew}><Plus size={19} aria-hidden="true" /> New group</button>
      </div>
      <div className="group-cards">
        {[...groups].sort((a, b) => b.updatedAt - a.updatedAt).map(group => (
          <a key={group.id} className="group-card" href={groupHref(group.id)}>
            <div className="group-card-top">
              <span className="group-icon"><UsersRound size={23} aria-hidden="true" /></span>
              <ChevronRight className="muted shrink-zero" size={21} aria-hidden="true" />
            </div>
            <h2>{group.name}</h2>
            <p>{peopleLabel(group.people)} · {payerLabel(group.payers.length)}</p>
            <div className="group-card-total">
              <span>Total spent</span>
              <strong>{money(totalSpent(group.expenses))}</strong>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

function GroupPage({
  group, tab, onEditGroup, onExpense, onShare,
}: {
  group: SplitGroup;
  tab: Route['tab'];
  onEditGroup: () => void;
  onExpense: (expense?: Expense) => void;
  onShare: (result: Settlement) => void;
}) {
  const result = useMemo(() => settle(group), [group]);
  const payerById = new Map(group.payers.map(payer => [payer.id, payer]));
  const expenses = [...group.expenses].reverse().sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <div className="group-toolbar">
        <a className="back-link" href="#groups"><ArrowLeft size={17} aria-hidden="true" /> All groups</a>
        <button type="button" className="button quiet edit-group" onClick={onEditGroup}>
          <Pencil size={16} aria-hidden="true" /> Edit group
        </button>
      </div>
      <div className="page-heading group-heading">
        <div>
          <h1>{group.name}</h1>
          <p><UsersRound size={17} aria-hidden="true" /> {peopleLabel(group.people)} · {payerLabel(group.payers.length)}</p>
        </div>
        <button className="button primary" onClick={() => onExpense()}>
          <Plus size={19} aria-hidden="true" /> Add expense
        </button>
      </div>

      <div className="summary" aria-label="Group totals">
        <div className="summary-total">
          <span>Total spent</span>
          <strong>{money(result.total)}</strong>
        </div>
        <div className="summary-per-person">
          <span>Average per person</span>
          <strong>{money(result.averagePerPerson)}</strong>
        </div>
        <Wallet className="summary-icon" size={27} aria-hidden="true" />
      </div>
      <nav className="group-tabs" aria-label="Group view">
        <a href={groupHref(group.id)} aria-current={tab === 'expenses' ? 'page' : undefined}>
          <ReceiptText size={17} aria-hidden="true" /> Expenses
        </a>
        <a href={groupHref(group.id, 'settle')} aria-current={tab === 'settle' ? 'page' : undefined}>
          <ArrowRight size={17} aria-hidden="true" /> Settle up
        </a>
      </nav>

      {tab === 'expenses' ? (
        <div className="group-columns">
          <section className="panel group-primary" aria-labelledby="expenses-heading">
            <div className="panel-heading"><h2 id="expenses-heading">Expenses</h2><span>{expenses.length} {expenses.length === 1 ? 'entry' : 'entries'}</span></div>
            {expenses.length ? (
              <ul className="expense-list">
                {expenses.map(expense => (
                  <li key={expense.id}>
                    <button className="expense-row" onClick={() => onExpense(expense)}>
                      <span className="expense-icon"><ReceiptText size={20} aria-hidden="true" /></span>
                      <span className="expense-main">
                        <strong>{expense.description}</strong>
                        <span>Paid by {payerById.get(expense.payerId)?.name} · {dateLabel(expense.date)}</span>
                      </span>
                      <span className="expense-amount">{money(expense.amount)}</span>
                      <ChevronRight className="row-chevron" size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel-empty"><ReceiptText size={24} aria-hidden="true" /><h3>No expenses yet</h3><p>Log the first bill and choose who paid.</p></div>
            )}
          </section>
          <section className="panel group-aside" aria-labelledby="payers-heading">
            <div className="panel-heading"><h2 id="payers-heading">Payers</h2></div>
            <ul className="payers-list">
              {group.payers.map((payer, index) => (
                <li key={payer.id} className="payer-row">
                  <Avatar name={payer.name} index={index} />
                  <div className="payer-row-main"><strong>{payer.name}</strong><span>Covers {peopleLabel(payer.people)}</span></div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <div className="group-columns">
          <section className="panel group-primary" aria-labelledby="payments-heading">
            <div className="panel-heading settlement-heading">
              <h2 id="payments-heading">Who pays whom</h2>
              {!!group.expenses.length && (
                <button className="button secondary share-button" onClick={() => onShare(result)}>
                  <Share2 size={16} aria-hidden="true" /> Share settlement
                </button>
              )}
            </div>
            {result.transfers.length ? (
              <ul className="transfer-list">
                {result.transfers.map(({ from, to, amount }) => (
                  <li className="transfer-row" key={from.id + '/' + to.id}>
                    <span className="transfer-icon"><ArrowRight size={19} aria-hidden="true" /></span>
                    <span className="transfer-label"><strong>{from.name}</strong> pays <strong>{to.name}</strong></span>
                    <strong className="transfer-amount">{money(amount)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel-empty">
                <Check size={24} aria-hidden="true" />
                <h3>{group.expenses.length ? 'Everyone is settled' : 'No balances yet'}</h3>
                <p>{group.expenses.length ? 'Each payer has covered their share.' : 'Add an expense to see the split.'}</p>
              </div>
            )}
          </section>
          <section className="panel group-aside" aria-labelledby="balances-heading">
            <div className="panel-heading"><h2 id="balances-heading">Payer balances</h2></div>
            <ul className="balances-list">
              {result.balances.map((balance, index) => <BalanceRow key={balance.payer.id} balance={balance} index={index} />)}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function Avatar({ name, index }: { name: string; index: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  return <span aria-hidden="true" className={'avatar avatar-' + (index % 4)}>{initials}</span>;
}

function BalanceRow({ balance, index }: { balance: Balance; index: number }) {
  const { payer, net, paid, share } = balance;
  return (
    <li className="balance-row">
      <div className="balance-top">
        <Avatar name={payer.name} index={index} />
        <div className="payer-row-main"><strong>{payer.name}</strong><span>Covers {peopleLabel(payer.people)}</span></div>
        <span className={'balance-status ' + (net > 0n ? 'gets' : net < 0n ? 'owes' : 'settled')}>
          {net > 0n ? 'Gets ' + money(net) : net < 0n ? 'Owes ' + money(-net) : 'Settled'}
        </span>
      </div>
      <dl className="balance-details">
        <div><dt>Paid</dt><dd>{money(paid)}</dd></div>
        <div><dt>Share</dt><dd>{money(share)}</dd></div>
      </dl>
    </li>
  );
}

function InstallDialog({
  onClose, ready, installPrompt, onInstall,
}: {
  onClose: () => void;
  ready: boolean;
  installPrompt: boolean;
  onInstall: () => void;
}) {
  return (
    <Dialog title="Add to your Home Screen" onClose={onClose}>
      <div className="sheet-body install-guide">
        <div className="install-guide-top">
          <img src="/icons/icon-192.png" width="60" height="60" alt="" />
          <div><strong>EquiSplit</strong><span>Open it from your Home Screen.</span></div>
        </div>
        {installPrompt && <button className="button primary" onClick={onInstall}><Download size={18} aria-hidden="true" /> Install EquiSplit</button>}
        <div>
          <h3><Smartphone size={17} aria-hidden="true" /> iPhone and iPad</h3>
          <ol>
            <li>Open EquiSplit in Safari and tap <strong>Share</strong>.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Turn on <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</li>
          </ol>
        </div>
        {!installPrompt && (
          <div>
            <h3>Android and desktop</h3>
            <p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong> where available.</p>
          </div>
        )}
        <p className="offline-status">
          <CloudOff size={19} aria-hidden="true" /> {ready
            ? 'Ready to use offline on this device.'
            : 'Open EquiSplit while online once to prepare it for offline use.'}
        </p>
      </div>
    </Dialog>
  );
}
