/** Base class for every error the app raises on purpose. */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Thrown by every scaffolding stub. Search the repo for `TODO(feature)` to find them. */
export class NotImplementedError extends AppError {
  constructor(what: string) {
    super('not_implemented', `TODO(feature): ${what} is not implemented yet`);
  }
}

/** Fail loudly from a stub. `what` names the missing behaviour. */
export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}

/** App config (app.config.ts `extra`) is missing or malformed. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super('config_error', message);
  }
}

/** One or more `.tflite` files named in assets/models/manifest.json are not bundled. */
export class ModelsUnavailableError extends AppError {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      'models_unavailable',
      `Recognition models are missing: ${missing.join(', ')}. ` +
        'Copy the .tflite files into mobile/assets/models/, run `npm run models:sync`, then rebuild.',
    );
    this.missing = missing;
  }
}

/** assets/models/manifest.json does not match the expected shape. */
export class ManifestError extends AppError {
  constructor(message: string) {
    super('manifest_invalid', `Invalid model manifest: ${message}`);
  }
}
