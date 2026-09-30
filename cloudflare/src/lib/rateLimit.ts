import type { Session } from '../types';
const limits: Record<string, [number, number]> = {
	currentInput: [60, 30],
	'word:success': [10, 5],
	'room:join': [5, 2],
	'room:leave': [5, 2],
	'game:start': [2, 1],
	'auth:response': [3, 0.5],
	'health:ping': [2, 0.2],
	'health:database': [2, 0.2],
};
export function acceptEvent(session: Session, event: string, now = Date.now()): boolean {
	const limit = Object.hasOwn(limits, event) ? limits[event] : undefined;
	if (!limit) return false;
	const [capacity, perSecond] = limit;
	const bucket = session.buckets[event] ?? { tokens: capacity, updatedAt: now };
	bucket.tokens = Math.min(capacity, bucket.tokens + (Math.max(0, now - bucket.updatedAt) * perSecond) / 1000);
	bucket.updatedAt = now;
	session.buckets[event] = bucket;
	if (bucket.tokens < 1) return false;
	bucket.tokens -= 1;
	return true;
}
