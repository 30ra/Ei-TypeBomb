import { DurableObject } from 'cloudflare:workers';
import type { GameState, Session, WorkerEnv } from './types';
import { capture, ClientError, getRoom, validateDisplayName, verifyToken } from './lib/services';
import { acceptEvent } from './lib/rateLimit';

const IDLE_TIMEOUT = 75_000;
const AUTH_TIMEOUT = 20_000;

export class GameRoom extends DurableObject<WorkerEnv> {
	private game?: GameState;
	constructor(ctx: DurableObjectState, env: WorkerEnv) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.game = await ctx.storage.get<GameState>('game');
		});
	}
	private send(ws: WebSocket, event: string, data?: unknown) {
		try {
			ws.send(JSON.stringify({ event, data }));
		} catch {
			/* Close/error handler cleans up membership. */
		}
	}
	private broadcast(event: string, data?: unknown) {
		for (const ws of this.ctx.getWebSockets()) {
			if ((ws.deserializeAttachment() as Session).authenticated) this.send(ws, event, data);
		}
	}
	private snapshot() {
		if (this.game) this.broadcast('room:broadcast', this.game.room);
	}
	private track(event: string, properties: Record<string, unknown> = {}) {
		console.log(JSON.stringify({ event, roomId: this.game?.room.id, ...properties }));
		this.ctx.waitUntil(capture(this.env, event, properties));
	}
	private async save() {
		if (this.game) await this.ctx.storage.put('game', this.game);
		else await this.ctx.storage.delete('game');
		const deadlines: number[] = [];
		if (this.game?.wordAt) deadlines.push(this.game.wordAt);
		if (this.game?.bombAt) deadlines.push(this.game.bombAt);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws.readyState !== WebSocket.OPEN) continue;
			const session = ws.deserializeAttachment() as Session;
			deadlines.push(session.lastSeen + (session.authenticated ? IDLE_TIMEOUT : AUTH_TIMEOUT));
		}
		if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
		else await this.ctx.storage.deleteAlarm();
	}
	async fetch(request: Request): Promise<Response> {
		// A fresh connection cannot inherit stale players after all old sockets disappeared.
		if (!this.ctx.getWebSockets().length) this.game = undefined;
		const pair = new WebSocketPair();
		const session: Session = {
			id: crypto.randomUUID(),
			roomId: new URL(request.url).pathname.split('/')[2],
			authenticated: false,
			lastSeen: Date.now(),
			buckets: {},
		};
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].serializeAttachment(session);
		this.send(pair[1], 'connect', { id: session.id });
		this.send(pair[1], 'auth:request');
		await this.save();
		return new Response(null, { status: 101, webSocket: pair[0] });
	}
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		// Serialize asynchronous auth/DB reads with joins, disconnects, and alarms.
		await this.ctx.blockConcurrencyWhile(async () => {
			const session = ws.deserializeAttachment() as Session;
			try {
				if (typeof message !== 'string' || message.length > 16_384) {
					ws.close(1009, 'Message too large');
					return;
				}
				const packet = JSON.parse(message);
				if (!packet || typeof packet.event !== 'string') return;
				if (packet.event === 'ping') {
					if (session.authenticated) session.lastSeen = Date.now();
					ws.serializeAttachment(session);
					this.send(ws, 'pong');
					return;
				}
				if (packet.event === 'health:ping') {
					if (typeof packet.data === 'string') this.send(ws, 'health:pong', packet.data);
					return;
				}
				if (!acceptEvent(session, packet.event)) {
					ws.serializeAttachment(session);
					return;
				}
				ws.serializeAttachment(session);
				if (packet.event === 'auth:response') {
					const id = await verifyToken(packet.data?.jwtToken, this.env.JWT_SECRET);
					if (!id || id !== session.roomId) throw new ClientError('認証トークンが無効または有効期限切れです。ルームに入り直してください。');
					const displayName = validateDisplayName(packet.data?.displayName);
					if (!this.game) this.game = { room: await getRoom(this.env, id) };
					session.displayName = displayName;
					session.authenticated = true;
					session.lastSeen = Date.now();
					ws.serializeAttachment(session);
					const user = this.game.room.users.find((user) => user.id === session.id);
					if (user) user.displayName = displayName;
					this.track('room_authenticated');
					await this.save();
					this.snapshot();
					return;
				}
				if (!session.authenticated || !this.game) return;
				session.lastSeen = Date.now();
				ws.serializeAttachment(session);
				const room = this.game.room;
				switch (packet.event) {
					case 'room:join':
						if (!room.maxPlayers || room.users.length >= room.maxPlayers) return;
						if (!room.users.some((user) => user.id === session.id)) {
							room.users.push({ id: session.id, displayName: session.displayName! });
							this.track('player_joined', { player_count: room.users.length });
						}
						break;
					case 'room:leave':
						this.leave(session, 'room_leave');
						break;
					case 'currentInput':
						if (room.isStart && room.users[room.bombHolder]?.id === session.id && typeof packet.data === 'string') {
							this.broadcast('typing:input', { input: packet.data.slice(0, 32) });
						}
						return;
					case 'word:success':
						if (!room.isStart || this.game.wordAt || room.users[room.bombHolder]?.id !== session.id) return;
						room.bombHolder = (room.bombHolder + 1) % room.users.length;
						room.wordIndex = Math.floor(Math.random() * room.words.length);
						this.broadcast('typing:input', { input: '' });
						break;
					case 'game:start': {
						if (room.isStart || room.users.length < 2 || !room.users.some((user) => user.id === session.id)) return;
						const saved = await getRoom(this.env, room.id);
						room.gameDuration = saved.gameDuration;
						room.gameId = crypto.randomUUID();
						room.isStart = true;
						room.bombHolder = Math.floor(Math.random() * room.users.length);
						room.wordIndex = undefined;
						room.bombStatus = 0;
						this.game.wordAt = Date.now() + 3000;
						this.game.bombAt = this.nextBombAt();
						this.broadcast('typing:input', { input: '' });
						this.track('game_started', { player_count: room.users.length });
						break;
					}
				}
				await this.save();
				this.snapshot();
			} catch (error) {
				const message = error instanceof ClientError ? error.message : '処理に失敗しました。しばらくしてから再度お試しください。';
				this.send(ws, 'error', { message });
				this.track('server_error', { message });
			}
		});
	}
	private nextBombAt() {
		const duration = this.game?.room.gameDuration ?? 20;
		const base = Number.isInteger(duration) && duration >= 1 && duration <= 2147473 ? duration : 20;
		return Date.now() + (base + Math.random() * 10) * 1000;
	}
	private reset() {
		if (!this.game) return;
		Object.assign(this.game.room, { isStart: false, gameId: undefined, bombStatus: 0, bombHolder: 0, wordIndex: undefined });
		this.game.wordAt = this.game.bombAt = undefined;
		this.broadcast('typing:input', { input: '' });
	}
	private leave(session: Session, reason: string) {
		const room = this.game?.room;
		if (!room || !room.users.some((user) => user.id === session.id)) return;
		if (room.isStart) {
			this.track('game_cancelled', { reason, player_count: room.users.length });
			this.reset();
			room.users = [];
			this.broadcast('game:quited');
		} else room.users = room.users.filter((user) => user.id !== session.id);
		this.track('player_left', { reason, player_count: room.users.length });
	}
	async webSocketClose(ws: WebSocket) {
		await this.remove(ws);
	}
	async webSocketError(ws: WebSocket) {
		await this.remove(ws);
	}
	private async remove(ws: WebSocket) {
		await this.ctx.blockConcurrencyWhile(async () => {
			this.leave(ws.deserializeAttachment() as Session, 'disconnect');
			try {
				ws.close(1000, 'Disconnected');
			} catch {
				/* Already closed. */
			}
			if (!this.ctx.getWebSockets().some((other) => other !== ws && (other.deserializeAttachment() as Session).authenticated))
				this.game = undefined;
			await this.save();
			this.snapshot();
		});
	}
	async alarm() {
		await this.ctx.blockConcurrencyWhile(async () => {
			const now = Date.now();
			for (const ws of this.ctx.getWebSockets()) {
				const session = ws.deserializeAttachment() as Session;
				if (session.lastSeen + (session.authenticated ? IDLE_TIMEOUT : AUTH_TIMEOUT) <= now) {
					this.leave(session, 'disconnect');
					session.authenticated = false;
					ws.serializeAttachment(session);
					ws.close(1000, 'Connection timed out');
				}
			}
			if (!this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Session).authenticated)) this.game = undefined;
			if (this.game?.room.isStart) {
				const room = this.game.room;
				if (this.game.wordAt && this.game.wordAt <= now) {
					this.game.wordAt = undefined;
					room.wordIndex = Math.floor(Math.random() * room.words.length);
					this.broadcast('typing:input', { input: '' });
				}
				if (this.game.bombAt && this.game.bombAt <= now) {
					if (room.bombStatus === 4) {
						const loser = room.users[room.bombHolder];
						if (loser) this.broadcast('game:end', { holderUserId: loser.id, holderDisplayName: loser.displayName });
						this.track('game_finished', { player_count: room.users.length });
						this.reset();
						room.users = [];
					} else {
						room.bombStatus++;
						this.game.bombAt = this.nextBombAt();
					}
				}
			}
			await this.save();
			this.snapshot();
		});
	}
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
		const permitted = !origin || allowed.includes('*') || allowed.includes(origin);
		const headers = {
			'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : permitted && origin ? origin : '',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			Vary: 'Origin',
		};
		if (!permitted) return new Response('Origin not allowed', { status: 403 });
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
		if (url.pathname === '/' || url.pathname === '/health') return Response.json({ status: 'ok', service: 'ei-typebomb' }, { headers });
		if (!/^\/ws\/(?:[\da-f-]{36}|health)$/.test(url.pathname)) return new Response('Not found', { status: 404, headers });
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426, headers });
		return env.GAME_ROOMS.getByName(url.pathname.split('/')[2]).fetch(request);
	},
} satisfies ExportedHandler<WorkerEnv>;
