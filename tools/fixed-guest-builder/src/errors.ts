export type BuildErrorCode =
  | 'INVALID_INPUT'
  | 'SOURCE_UNREACHABLE'
  | 'LIMIT_EXCEEDED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'VERIFY_FAILED'
  | 'UNUSABLE_KEY'
  | 'NOT_REPRODUCIBLE'
  | 'BUSY'
  | 'EXTERNAL';

export class BuildError extends Error {
  readonly code: BuildErrorCode;

  constructor(code: BuildErrorCode, message: string) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
  }
}

export function fail(code: BuildErrorCode, message: string): never {
  throw new BuildError(code, message);
}
