const APP_ID_ENV_KEYS = ['META_APP_INSTALLS_APP_ID', 'META_APP_ID', 'FB_APP_ID', 'APP_ID'] as const;
const APP_STORE_URL_ENV_KEYS = [
  'META_APP_INSTALLS_STORE_URL',
  'META_APP_STORE_URL',
  'APP_STORE_URL',
  'APP_INSTALLS_STORE_URL',
  'MOBILE_APP_STORE_URL',
] as const;
const SKAD_ENV_KEYS = [
  'META_APP_INSTALLS_SKADNETWORK_ATTRIBUTION',
  'META_SKADNETWORK_ATTRIBUTION',
  'APP_INSTALLS_SKADNETWORK_ATTRIBUTION',
] as const;

export type AppInstallsConfig = {
  applicationId: string;
  objectStoreUrl: string;
  isSkadnetworkAttribution?: boolean;
  appIdEnvKey: string;
  objectStoreUrlEnvKey: string;
  skadEnvKey?: string;
};

function resolveEnv(keys: readonly string[]): { key: string | null; value: string | null } {
  for (const key of keys) {
    const raw = process.env[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return { key, value: raw.trim() };
    }
  }
  return { key: null, value: null };
}

function parseBooleanEnv(raw: string | null): boolean | undefined {
  if (!raw) return undefined;

  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;

  return undefined;
}

export function getAppInstallsConfig(): AppInstallsConfig | null {
  const appId = resolveEnv(APP_ID_ENV_KEYS);
  const storeUrl = resolveEnv(APP_STORE_URL_ENV_KEYS);

  if (!appId.value || !storeUrl.value || !appId.key || !storeUrl.key) {
    return null;
  }

  const skad = resolveEnv(SKAD_ENV_KEYS);
  const parsedSkad = parseBooleanEnv(skad.value);

  return {
    applicationId: appId.value,
    objectStoreUrl: storeUrl.value,
    ...(parsedSkad !== undefined && { isSkadnetworkAttribution: parsedSkad }),
    appIdEnvKey: appId.key,
    objectStoreUrlEnvKey: storeUrl.key,
    ...(skad.key && { skadEnvKey: skad.key }),
  };
}

export function getAppInstallsConfigEnvHints() {
  return {
    appIdEnvKeys: APP_ID_ENV_KEYS,
    appStoreUrlEnvKeys: APP_STORE_URL_ENV_KEYS,
    skadEnvKeys: SKAD_ENV_KEYS,
  };
}

export function requireAppInstallsConfig(): AppInstallsConfig {
  const config = getAppInstallsConfig();

  if (!config) {
    throw new Error(
      'Missing app installs configuration in env. Set META_APP_INSTALLS_APP_ID (or META_APP_ID/FB_APP_ID) ' +
      'and META_APP_INSTALLS_STORE_URL (or META_APP_STORE_URL/APP_STORE_URL).'
    );
  }

  return config;
}
