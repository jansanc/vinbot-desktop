declare module "tar" {
  interface CreateOptions {
    gzip?: boolean;
    file?: string;
    cwd?: string;
  }

  export function create(
    options: CreateOptions,
    files: string[]
  ): Promise<void>;
}
