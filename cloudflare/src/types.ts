export interface Secrets {
	JWT_SECRET: string;
	NEXT_PUBLIC_SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	NEXT_PUBLIC_POSTHOG_KEY?: string;
	POSTHOG_HOST?: string;
}
export type WorkerEnv = Env & Secrets;
export type User = { id: string; displayName: string };
export type Room = {
	id: string;
	title?: string;
	userId?: string;
	explanation?: string;
	maxPlayers?: number;
	gameDuration: number;
	createdAt?: string;
	updatedAt?: string;
	words: { jp: string; en: string }[];
	users: User[];
	isStart: boolean;
	gameId?: string;
	bombHolder: number;
	wordIndex?: number;
	bombStatus: number;
};
export type GameState = { room: Room; wordAt?: number; bombAt?: number };
export type Session = {
	id: string;
	roomId: string;
	displayName?: string;
	authenticated: boolean;
	lastSeen: number;
	buckets: Record<string, { tokens: number; updatedAt: number }>;
};
