import { afterEach, describe, expect, it } from 'vitest';
import { Vencura } from './index';

// Regression for the browser "Illegal invocation" bug: the SDK must invoke the global fetch BOUND
// to globalThis. A browser's native fetch throws when called with `this` !== window; Node's fetch
// doesn't, so this is the only place that guards the binding from regressing (it had broken every
// SDK call in the browser — i.e. the whole web app — while examples/CLI passed in Node).
describe('Vencura transport — default fetch binding', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('binds the default fetch to globalThis (no Illegal invocation)', async () => {
    const seen: string[] = [];
    // Stand in for browser fetch: reject any call whose `this` isn't the global object.
    globalThis.fetch = function (this: unknown, input: unknown): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      seen.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ network: 'sepolia', blockNumber: 1, gasGwei: 1 }), { status: 200 }),
      );
    } as typeof fetch;

    const v = new Vencura({ basePath: 'https://api.example' });
    const head = await v.chain.head(); // would throw "Illegal invocation" if fetch weren't bound

    expect(head).toEqual({ network: 'sepolia', blockNumber: 1, gasGwei: 1 });
    expect(seen[0]).toContain('/chain/head');
  });

  it('still honors an explicitly injected fetch', async () => {
    let called = false;
    const v = new Vencura({
      basePath: 'https://api.example',
      fetch: ((input: unknown) => {
        called = true;
        return Promise.resolve(new Response(JSON.stringify({ blockNumber: 7 }), { status: 200 }));
      }) as typeof fetch,
    });
    await v.chain.head();
    expect(called).toBe(true);
  });
});
