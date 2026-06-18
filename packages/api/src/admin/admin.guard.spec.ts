import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminGuard } from './admin.guard';

// Builds a minimal ExecutionContext exposing just the request headers the guard reads.
const ctx = (headers: Record<string, string>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as ExecutionContext;

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  const original = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = 's3cret-admin-key';
  });
  afterEach(() => {
    process.env.ADMIN_API_KEY = original;
  });

  it('allows the request when x-admin-key matches ADMIN_API_KEY', () => {
    expect(guard.canActivate(ctx({ 'x-admin-key': 's3cret-admin-key' }))).toBe(true);
  });

  it('rejects when the x-admin-key header is missing', () => {
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });

  it('rejects when the x-admin-key header is wrong', () => {
    expect(() => guard.canActivate(ctx({ 'x-admin-key': 'nope' }))).toThrow(ForbiddenException);
  });

  it('fails closed when ADMIN_API_KEY is not configured', () => {
    delete process.env.ADMIN_API_KEY;
    expect(() => guard.canActivate(ctx({ 'x-admin-key': 'anything' }))).toThrow(ForbiddenException);
  });
});
