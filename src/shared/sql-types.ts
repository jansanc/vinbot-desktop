export interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

export interface SqlJsStatic {
  Database: new (buffer: Buffer) => SqlJsDatabase;
}
