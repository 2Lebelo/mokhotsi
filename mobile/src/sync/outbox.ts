import type { Op } from '@/contracts/sync';
import type { OutboxRow } from '@/db/schema';

/** Map a stored outbox row to the wire `Op` (contracts/sync.schema.json#/$defs/Op). */
export function toOp(row: OutboxRow): Op {
  return {
    op_id: row.opId,
    entity: row.entity,
    entity_id: row.entityId,
    op: row.op,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
}
