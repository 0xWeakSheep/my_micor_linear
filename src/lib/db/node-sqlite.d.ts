declare module "node:sqlite" {
  export type SQLInputValue = string | number | bigint | null | Uint8Array;
  export type SQLOutputValue = string | number | bigint | null | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...anonymousParameters: SQLInputValue[]): Array<Record<string, SQLOutputValue>>;
    get(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    iterate(...anonymousParameters: SQLInputValue[]): IterableIterator<Record<string, SQLOutputValue>>;
    run(...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
    setAllowBareNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
    timeout?: number;
  }

  export class DatabaseSync {
    constructor(path: string | Buffer | URL, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
