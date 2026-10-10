import { useEffect, useMemo, useState } from 'react';

import { subscribe, type Table } from '@/db/changes';

/**
 * Run a synchronous local read and re-run it whenever one of `tables` changes (see
 * src/db/changes.ts) or `arg` changes. `read` should be a module-level function, so it is
 * stable between renders. Reads are cheap indexed SQLite queries.
 */
export function useLiveRead<A, T>(tables: readonly Table[], read: (arg: A) => T, arg: A): T {
  const [version, setVersion] = useState(0);
  const key = tables.join(',');

  useEffect(() => subscribe(key.split(',') as Table[], () => setVersion((v) => v + 1)), [key]);

  // `version` is a deliberate extra dependency: it changes when the underlying tables do.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => read(arg), [read, arg, version]);
}
