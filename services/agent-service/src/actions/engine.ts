import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '../adapters/facebook.js';

type ParamSpec = {
  type: string;
  required?: boolean;
  values?: any[];
  min_value?: number;
  max_length?: number;
  unit?: string;
  example?: any;
  description?: string;
  format?: string;
};

type ActionSpec = {
  action: string;
  level: 'campaign'|'adset'|'ad'|'ad_account';
  method: 'GET'|'POST'|'DELETE';
  path: string;
  params: Record<string, ParamSpec>;
  verify?: { method?: 'GET'; path?: string; fields?: string[]; query?: Record<string, any>; description?: string; expect?: string; };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest: ActionSpec[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

function interpolatePath(tpl: string, input: Record<string, any>): string {
  let p = tpl;
  p = p.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
    const v = input[k];
    if (v === undefined || v === null) throw new Error(`Missing path param {${k}}`);
    return String(v);
  });
  if (p.startsWith('/v')) {
    const m = p.match(/^\/v\d+\.\d+\/(.*)$/);
    if (m) p = m[1];
    if (p.startsWith('/')) p = p.slice(1);
  }
  return p;
}

function buildParams(spec: ActionSpec, input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, ps] of Object.entries(spec.params || {})) {
    const val = (input as any)[key];
    if (ps.required && (val === undefined || val === null || val === '')) {
      throw new Error(`Missing required param: ${key}`);
    }
    if (val === undefined) continue;
    if (ps.min_value !== undefined && typeof val === 'number' && val < ps.min_value) {
      throw new Error(`Param ${key} below min_value ${ps.min_value}`);
    }
    if (ps.max_length !== undefined && typeof val === 'string' && val.length > ps.max_length) {
      throw new Error(`Param ${key} exceeds max_length ${ps.max_length}`);
    }
    if (ps.values && !ps.values.includes(val)) {
      throw new Error(`Param ${key} not in allowed values`);
    }
    out[key] = val;
  }
  return out;
}

export function getActionSpec(name: string): ActionSpec | undefined {
  return manifest.find(a => a.action === name);
}

export async function executeByManifest(actionName: string, params: Record<string, any>, accessToken: string) {
  const spec = getActionSpec(actionName);
  if (!spec) throw new Error(`Unknown action in manifest: ${actionName}`);
  const path = interpolatePath(spec.path, params);
  const body = buildParams(spec, params);
  return await graph(spec.method, path, accessToken, body);
}
