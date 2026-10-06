/**
 * Contract drift guard (mirrors api/tests/test_contracts.py):
 * 1. every example in contracts/examples validates against contracts/sync.schema.json;
 * 2. the TS mirror (src/contracts/sync.ts) has exactly the schema's property names;
 * 3. the examples are assignable to the TS types after validation.
 */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import pullResponse from '@contracts/examples/pull-response.json';
import pushRequest from '@contracts/examples/push-request.json';
import pushResponse from '@contracts/examples/push-response.json';
import schema from '@contracts/sync.schema.json';

import {
  CONTRACT_KEYS,
  ENTITY_VALUES,
  MATCH_METHOD_VALUES,
  OP_KIND_VALUES,
  PUSH_MAX_OPS,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@/contracts/sync';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);

function validatorFor<T>(def: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(`${schema.$id}#/$defs/${def}`);
  if (!validate) throw new Error(`schema def ${def} not found`);
  // The contract has no `$async` schemas, so every validator is synchronous.
  return validate as ValidateFunction<T>;
}

describe('contracts/examples validate against sync.schema.json', () => {
  it.each([
    ['PushRequest', pushRequest],
    ['PushResponse', pushResponse],
    ['PullResponse', pullResponse],
  ])('%s', (def, example) => {
    const validate = validatorFor(def);
    const ok = validate(example);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe('TS mirror matches the schema', () => {
  const defs = schema.$defs as Record<string, { properties?: Record<string, unknown>; enum?: string[] }>;

  it.each(Object.entries(CONTRACT_KEYS))('%s has the same property names', (def, keys) => {
    expect(Object.keys(defs[def]?.properties ?? {}).sort()).toEqual(Object.keys(keys).sort());
  });

  it('enums match', () => {
    expect(defs.Entity?.enum).toEqual([...ENTITY_VALUES]);
    expect(defs.OpKind?.enum).toEqual([...OP_KIND_VALUES]);
    expect(defs.MatchMethod?.enum).toEqual([...MATCH_METHOD_VALUES]);
  });

  it('push batch limit matches', () => {
    expect(schema.$defs.PushRequest.properties.ops.maxItems).toBe(PUSH_MAX_OPS);
  });
});

describe('examples type-check as TS contract types', () => {
  it('narrows validated examples to the TS types', () => {
    const req: unknown = pushRequest;
    const res: unknown = pushResponse;
    const pull: unknown = pullResponse;
    const isPushRequest = validatorFor<PushRequest>('PushRequest');
    const isPushResponse = validatorFor<PushResponse>('PushResponse');
    const isPullResponse = validatorFor<PullResponse>('PullResponse');
    if (!isPushRequest(req)) throw new Error('invalid PushRequest');
    if (!isPushResponse(res)) throw new Error('invalid PushResponse');
    if (!isPullResponse(pull)) throw new Error('invalid PullResponse');
    // Compile-time: these property accesses only type-check against the TS interfaces.
    expect(req.ops.length).toBeLessThanOrEqual(PUSH_MAX_OPS);
    expect(res.acked.length + res.rejected.length).toBe(req.ops.length);
    expect(pull.changes.sales[0]?.items[0]?.unit_price_cents).toBe(4599);
  });
});
