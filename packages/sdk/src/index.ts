import type { Hex } from '@vencura/shared';

// Typed client over the OpenAPI spec is generated in T-025. For now this proves
// the SDK consumes the shared vocabulary across the workspace boundary.
export type WalletAddress = Hex;
