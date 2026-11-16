import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { validGroup, type SplitGroup } from './split';

type Snapshot = { version: 1; groups: SplitGroup[] };

interface EquiSplitDB extends DBSchema {
  records: { key: 'groups'; value: Snapshot };
}

let connection: Promise<IDBPDatabase<EquiSplitDB>> | undefined;

function database() {
  if (!connection) {
    connection = openDB<EquiSplitDB>('equisplit-web', 1, {
      upgrade(db) {
        db.createObjectStore('records');
      },
      blocking() {
        void connection?.then(db => db.close());
        connection = undefined;
      },
      terminated() {
        connection = undefined;
      },
    }).catch(error => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

function unpack(snapshot: Snapshot | undefined): SplitGroup[] {
  if (snapshot === undefined) return [];
  if (snapshot.version !== 1 || !Array.isArray(snapshot.groups)) {
    throw new Error('Unexpected saved data format.');
  }
  verifyGroups(snapshot.groups);
  return snapshot.groups;
}

function verifyGroups(groups: SplitGroup[]) {
  if (!groups.every(validGroup) || new Set(groups.map(({ id }) => id)).size !== groups.length) {
    throw new Error('The saved group information is invalid.');
  }
}

export async function readGroups(): Promise<SplitGroup[]> {
  const db = await database();
  return unpack(await db.get('records', 'groups'));
}

export async function changeGroups(change: (groups: SplitGroup[]) => SplitGroup[]): Promise<SplitGroup[]> {
  const db = await database();
  const transaction = db.transaction('records', 'readwrite');
  try {
    const current = unpack(await transaction.store.get('groups'));
    const groups = change(current);
    verifyGroups(groups);
    await transaction.store.put({ version: 1, groups }, 'groups');
    await transaction.done;
    return groups;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // IndexedDB may have already aborted after a storage error.
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}

export function editGroup(
  groups: SplitGroup[],
  snapshot: SplitGroup,
  update: (group: SplitGroup) => SplitGroup | null,
): SplitGroup[] {
  const current = groups.find(group => group.id === snapshot.id);
  if (!current || current.updatedAt !== snapshot.updatedAt) {
    throw new Error('This group changed in another window. Reopen the form to see the latest version.');
  }
  const result = update(current);
  if (!result) return groups.filter(({ id }) => id !== current.id);
  const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
  return groups.map(group => group.id === current.id ? { ...result, updatedAt } : group);
}
