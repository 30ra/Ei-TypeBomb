export interface Secrets {
	JWT_SECRET: string;
	NEXT_PUBLIC_SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	NEXT_PUBLIC_POSTHOG_KEY?: string;
	POSTHOG_HOST?: string;
}
export type WorkerEnv = Env & Secrets;
export type { User, TypedRecallItem, Item, Room, GameState } from '../../shared/types';
export type Session = {
	id: string;
	roomId: string;
	displayName?: string;
	authenticated: boolean;
	lastSeen: number;
	buckets: Record<string, { tokens: number; updatedAt: number }>;
};
