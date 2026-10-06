import { randomUUID } from 'expo-crypto';

/** RFC 4122 v4 UUID string. All entity ids and op ids are generated on the client. */
export type Uuid = string;

export function newId(): Uuid {
  return randomUUID();
}
