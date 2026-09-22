// Secret bytes that do not leak through ordinary handling. The bytes live in a private field (#bytes),
// which JSON.stringify, object spread, structuredClone and util.inspect never see; every string form is
// "[redacted]". `reveal()` returns a fresh copy for the one place that needs the bytes (the Keyring), so a
// caller mutating what it got cannot change the stored key.

import { inspect } from "node:util";

export class SecretBytes {
  readonly #bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes); // own copy: later changes to the source do not reach it
    Object.freeze(this);
  }
  get length(): number {
    return this.#bytes.length;
  }
  /** A fresh copy of the bytes. */
  reveal(): Uint8Array {
    return new Uint8Array(this.#bytes);
  }
  toJSON(): string {
    return "[redacted]";
  }
  toString(): string {
    return "[redacted]";
  }
  [Symbol.toPrimitive](): string {
    return "[redacted]";
  }
  [inspect.custom](): string {
    return "SecretBytes [redacted]";
  }
}
