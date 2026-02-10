const APP_ID_ENV_KEYS = ['META_APP_INSTALLS_APP_ID', 'META_APP_ID', 'FB_APP_ID', 'APP_ID'] as const;

export type AppInstallsConfig = {
  applicationId: string;
  appIdEnvKey: string;
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

export function getAppInstallsConfig(): AppInstallsConfig | null {
  const appId = resolveEnv(APP_ID_ENV_KEYS);
  if (!appId.value || !appId.key) {
    return null;
  }

  return {
    applicationId: appId.value,
    appIdEnvKey: appId.key,
  };
}

export function getAppInstallsConfigEnvHints() {
  return {
    appIdEnvKeys: APP_ID_ENV_KEYS,
  };
}

export function requireAppInstallsConfig(): AppInstallsConfig {
  const config = getAppInstallsConfig();

  if (!config) {
    throw new Error(
      'Missing app installs app_id in env. Set META_APP_INSTALLS_APP_ID (or META_APP_ID/FB_APP_ID/APP_ID).'
    );
  }

  return config;
}
