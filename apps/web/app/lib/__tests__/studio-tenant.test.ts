import { describe, expect, it } from 'vitest';
import {
  STUDIO_TENANT_COOKIE,
  readTenantCookie,
  resolveStudioTenant,
  tenantStatusNotice,
  withStudioTenant,
  type StudioTenantOption,
} from '../studio-tenant';

const A = '4c47689f-9fff-4039-a2ac-529d1d620073';
const B = '337e8a9e-7de9-4511-a2da-324f1e95ea82';
const C = 'c9565f55-97da-45dc-be3c-6b522a982f17';

const tenant = (id: string, status: string, name = `Studio ${id.slice(0, 2)}`): StudioTenantOption => ({ id, name, status, role: 'OWNER' });

describe('resolveStudioTenant', () => {
  it('says none when the person has no studio', () => {
    expect(resolveStudioTenant({ options: [], selectedId: undefined })).toEqual({ kind: 'none' });
  });

  it('uses the only active studio without asking', () => {
    const state = resolveStudioTenant({ options: [tenant(A, 'ACTIVE')], selectedId: undefined });
    expect(state).toMatchObject({ kind: 'ready', active: { id: A } });
  });

  it('asks which studio when there are several active ones', () => {
    const state = resolveStudioTenant({ options: [tenant(A, 'ACTIVE'), tenant(B, 'ACTIVE')], selectedId: undefined });
    expect(state).toMatchObject({ kind: 'choose' });
  });

  it('keeps a remembered studio that is still in the list', () => {
    const state = resolveStudioTenant({ options: [tenant(A, 'ACTIVE'), tenant(B, 'ACTIVE')], selectedId: B });
    expect(state).toMatchObject({ kind: 'ready', active: { id: B } });
  });

  it('ignores a remembered studio that is not in the list', () => {
    const state = resolveStudioTenant({ options: [tenant(A, 'ACTIVE')], selectedId: C });
    expect(state).toMatchObject({ kind: 'ready', active: { id: A } });
  });

  it('blocks a person whose only studio is suspended or archived', () => {
    expect(resolveStudioTenant({ options: [tenant(B, 'SUSPENDED')], selectedId: undefined })).toMatchObject({
      kind: 'inactive',
      blocked: { id: B },
    });
    expect(resolveStudioTenant({ options: [tenant(B, 'ARCHIVED')], selectedId: B })).toMatchObject({
      kind: 'inactive',
      blocked: { id: B },
    });
  });

  it('lets a person with a suspended remembered studio switch to an active one', () => {
    const state = resolveStudioTenant({ options: [tenant(A, 'ACTIVE'), tenant(B, 'SUSPENDED')], selectedId: B });
    expect(state).toMatchObject({ kind: 'choose' });
  });
});

describe('tenantStatusNotice', () => {
  it('names why a studio cannot be used', () => {
    expect(tenantStatusNotice('SUSPENDED')).toContain('ditangguhkan');
    expect(tenantStatusNotice('ARCHIVED')).toContain('diarsipkan');
    expect(tenantStatusNotice('OTHER')).toContain('belum aktif');
  });
});

describe('readTenantCookie', () => {
  it('reads the studio cookie out of a cookie header', () => {
    expect(readTenantCookie(`a=1; ${STUDIO_TENANT_COOKIE}=${A}; b=2`)).toBe(A);
  });

  it('refuses a value that is not a uuid and an absent header', () => {
    expect(readTenantCookie(`${STUDIO_TENANT_COOKIE}=not-a-uuid`)).toBeUndefined();
    expect(readTenantCookie(undefined)).toBeUndefined();
    expect(readTenantCookie('')).toBeUndefined();
  });
});

describe('withStudioTenant', () => {
  const cookie = `${STUDIO_TENANT_COOKIE}=${A}`;

  it('adds the header to the tenant-scoped routes', () => {
    expect(withStudioTenant('/api/v1/articles?limit=50', {}, cookie)).toEqual({ 'x-tenant-id': A });
    expect(withStudioTenant('/api/v1/articles/abc/submit-review', {}, cookie)).toEqual({ 'x-tenant-id': A });
    expect(withStudioTenant('/api/v1/classes', {}, cookie)).toEqual({ 'x-tenant-id': A });
    expect(withStudioTenant('/api/v1/classes/abc/sessions', {}, cookie)).toEqual({ 'x-tenant-id': A });
    expect(withStudioTenant('/api/v1/tenants/current', {}, cookie)).toEqual({ 'x-tenant-id': A });
  });

  it('leaves every other route alone', () => {
    expect(withStudioTenant('/api/v1/tenants/mine', {}, cookie)).toEqual({});
    expect(withStudioTenant('/api/v1/marketplace/articles', {}, cookie)).toEqual({});
    expect(withStudioTenant('/api/v1/articlesx', {}, cookie)).toEqual({});
    expect(withStudioTenant('/api/v1/payouts?limit=50', {}, cookie)).toEqual({});
  });

  it('keeps a tenant header the caller already set', () => {
    expect(withStudioTenant('/api/v1/articles', { 'x-tenant-id': B }, cookie)).toEqual({ 'x-tenant-id': B });
  });

  it('keeps other headers and adds nothing without a cookie', () => {
    expect(withStudioTenant('/api/v1/articles', { 'Idempotency-Key': 'k' }, cookie)).toEqual({ 'Idempotency-Key': 'k', 'x-tenant-id': A });
    expect(withStudioTenant('/api/v1/articles', { 'Idempotency-Key': 'k' }, undefined)).toEqual({ 'Idempotency-Key': 'k' });
  });
});
