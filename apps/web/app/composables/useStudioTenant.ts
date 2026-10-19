import { computed } from 'vue';
import type { User } from '~/interfaces/auth';
import { tenantsApi } from '~/lib/api';
import { STUDIO_TENANT_COOKIE, resolveStudioTenant, type StudioTenantOption } from '~/lib/studio-tenant';

const OPTIONS_KEY = 'studio:tenant-options';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

async function loadOptions(isAdmin: boolean): Promise<StudioTenantOption[]> {
  if (isAdmin) return [];
  const mine = await tenantsApi.mine();
  return mine.map((tenant) => ({ id: tenant.id, name: tenant.name, status: tenant.status, role: tenant.membershipRole }));
}

export function useStudioTenant() {
  const user = useState<User | null>('user', () => null);
  const selected = useCookie<string | null>(STUDIO_TENANT_COOKIE, {
    default: () => null,
    path: '/',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  const isAdmin = computed(() => user.value?.role === 'ADMIN');

  const { data, status, error, refresh } = useAsyncData<StudioTenantOption[]>(OPTIONS_KEY, () => loadOptions(isAdmin.value));

  const options = computed(() => data.value ?? []);
  const state = computed(() => resolveStudioTenant({ options: options.value, selectedId: selected.value ?? undefined }));

  function select(id: string) {
    selected.value = id;
    clearNuxtData((key) => key.startsWith('studio:') && key !== OPTIONS_KEY);
  }

  return { options, state, status, error, refresh, select, isAdmin, selected };
}
