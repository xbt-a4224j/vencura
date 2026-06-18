// Minimal ambient types for the untyped `shamirs-secret-sharing` package (split/combine over Buffers).
declare module 'shamirs-secret-sharing' {
  export function split(secret: Buffer, opts: { shares: number; threshold: number }): Buffer[];
  export function combine(shares: Buffer[]): Buffer;
  const sss: { split: typeof split; combine: typeof combine };
  export default sss;
}
