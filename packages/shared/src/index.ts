/**
 * Shared domain types & schemas. Cross-package vocabulary lives here so the API,
 * SDK, and web app all speak the same language. Zod schemas are added as the
 * features that need them land (auth, wallets, transactions).
 */

/** A 0x-prefixed hex string (addresses, signatures, tx hashes). */
export type Hex = `0x${string}`;

/** Assets the platform can hold. ERC-20 token assets join this as they land. */
export const NATIVE_ASSET = 'ETH' as const;
export type NativeAsset = typeof NATIVE_ASSET;

export * from './auth.schema';
