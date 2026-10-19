export const STUDIO_TENANT_COOKIE = 'rc-studio-tenant';

export interface StudioTenantOption {
  id: string;
  name: string;
  status: string;
  role: string | null;
}

export type StudioTenantState =
  | { kind: 'none' }
  | { kind: 'choose'; options: StudioTenantOption[] }
  | { kind: 'inactive'; options: StudioTenantOption[]; blocked: StudioTenantOption }
  | { kind: 'ready'; options: StudioTenantOption[]; active: StudioTenantOption };

interface ResolveInput {
  options: ReadonlyArray<StudioTenantOption>;
  selectedId: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TENANT_SCOPED_ROUTES: ReadonlyArray<RegExp> = [/^\/api\/v1\/articles(?:[/?]|$)/, /^\/api\/v1\/classes(?:[/?]|$)/, /^\/api\/v1\/tenants\/current(?:[/?]|$)/];

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

const isActive = (option: StudioTenantOption): boolean => option.status === 'ACTIVE';

export function resolveStudioTenant({ options, selectedId }: ResolveInput): StudioTenantState {
  const all = [...options];
  if (all.length === 0) return { kind: 'none' };

  const selected = all.find((option) => option.id === selectedId);
  if (selected && isActive(selected)) return { kind: 'ready', options: all, active: selected };

  const active = all.filter(isActive);
  if (active.length === 1 && !selected) return { kind: 'ready', options: all, active: active[0] as StudioTenantOption };
  if (active.length >= 1) return { kind: 'choose', options: all };
  return { kind: 'inactive', options: all, blocked: (selected ?? all[0]) as StudioTenantOption };
}

export function tenantStatusNotice(status: string): string {
  if (status === 'SUSPENDED') return 'Studio ini sedang ditangguhkan, jadi artikel dan kelasnya tidak bisa dikelola sampai admin mengaktifkannya lagi.';
  if (status === 'ARCHIVED') return 'Studio ini sudah diarsipkan dan tidak bisa dikelola lagi.';
  return 'Studio ini belum aktif.';
}

export function readTenantCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== STUDIO_TENANT_COOKIE) continue;
    const value = safeDecode(rest.join('='));
    return UUID.test(value) ? value : undefined;
  }
  return undefined;
}

export function withStudioTenant(path: string, headers: Record<string, string>, cookieHeader: string | undefined): Record<string, string> {
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'x-tenant-id')) return headers;
  if (!TENANT_SCOPED_ROUTES.some((route) => route.test(path))) return headers;
  const tenantId = readTenantCookie(cookieHeader);
  return tenantId ? { ...headers, 'x-tenant-id': tenantId } : headers;
}
