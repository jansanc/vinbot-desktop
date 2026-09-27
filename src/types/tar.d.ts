declare module "tar" {
  interface CreateOptions {
    gzip?: boolean;
    file?: string;
    cwd?: string;
    /** Return false to leave the entry (and, for a directory, its contents) out. */
    filter?: (path: string, stat: unknown) => boolean;
  }

  export function create(
    options: CreateOptions,
    files: string[]
  ): Promise<void>;
}
