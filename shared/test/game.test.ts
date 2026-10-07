import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGameEvent, nextGameDeadline, type GameContext, type GameEvent } from '../game';
import type { GameState } from '../types';
import { NODE_GAME_RULES } from '../../server/src/lib/gameAdapter';
import { WORKER_GAME_RULES } from '../../cloudflare/src/lib/gameRules';
import { roomSnapshot } from '../protocol';
import { parseClientEvent, validateDisplayName, requireRoomItems } from '../validation';

const fresh = (): GameState => ({ room: {
    id: 'room', maxPlayers: 2, gameDuration: 20,
    items: [0, 1, 2].map(id => ({ id: String(id), type: 'typed_recall', prompt: '猫', answer: 'cat' })),
    users: [], isStart: false, bombHolder: 0, bombStatus: 0,
} });
const start: GameEvent = { type: 'game:start', playerId: 'a', gameId: 'game', gameDuration: 20 };
for (const [runtime, rules] of [['node', NODE_GAME_RULES], ['worker', WORKER_GAME_RULES]] as const) {
    const context: GameContext = { now: 1000, random: () => 0, rules };
    const apply = (state: GameState, event: GameEvent, overrides: Partial<GameContext> = {}) => applyGameEvent(state, event, { ...context, ...overrides });
    const joined = () => ['a', 'b'].reduce((state, id) => apply(state, { type: 'room:join', player: { id, displayName: id } }).state, fresh());
    const active = () => {
        const state = apply(joined(), start).state;
        return apply(state, { type: 'deadline' }, { now: state.wordAt! }).state;
    };
    test(`${runtime}: two players can start; one cannot`, () => {
        const one = apply(fresh(), { type: 'room:join', player: { id: 'a' } }).state;
        assert.equal(apply(one, start).state, one);
        const state = apply(joined(), start).state;
        assert.equal(state.room.isStart, true);
        assert.equal(state.wordAt, 4000);
        assert.equal(state.bombAt, 21000);
        assert.equal(nextGameDeadline(state), 4000);
        assert.equal(state.room.wordIndex, undefined);
        assert.equal(apply(state, start).state, state);
    });
    test(`${runtime}: holder passes to next player and wraps to first`, () => {
        const state = active();
        const next = apply(state, { type: 'word:success', playerId: 'a' }).state;
        assert.equal(next.room.bombHolder, 1);
        const wrapped = apply(next, { type: 'word:success', playerId: 'b' }).state;
        assert.equal(wrapped.room.bombHolder, 0);
        assert.equal(wrapped.bombAt, state.bombAt);
    });
    test(`${runtime}: word selection stays within the item range`, () => {
        for (const entropy of [0, 0.3, 0.999999, 1]) {
            const state = active();
            const next = apply(state, { type: 'word:success', playerId: 'a' }, { random: () => entropy }).state;
            assert.ok(next.room.wordIndex! >= 0 && next.room.wordIndex! < state.room.items.length);
        }
    });
    test(`${runtime}: non-holder successes and input are ignored`, () => {
        const state = active();
        for (const event of [{ type: 'word:success', playerId: 'b' }, { type: 'currentInput', playerId: 'b', input: 'cat' }] as const) {
            assert.deepEqual(apply(state, event), { state, effects: [] });
        }
        assert.deepEqual(apply(state, { type: 'currentInput', playerId: 'a', input: {} }), { state, effects: [] });
        assert.deepEqual(apply(state, { type: 'currentInput', playerId: 'a', input: 'x'.repeat(40) }).effects,
            [{ type: 'broadcast', packet: { event: 'typing:input', data: { input: 'x'.repeat(32) } } }]);
    });
    test(`${runtime}: joins are idempotent and never exceed capacity`, () => {
        const state = joined();
        assert.equal(apply(state, { type: 'room:join', player: { id: 'c' } }).state, state);
        state.room.maxPlayers = 3;
        assert.equal(apply(state, { type: 'room:join', player: { id: 'a' } }).state.room.users.length, 2);
    });
    test(`${runtime}: leaving an active game resets all state and deadlines`, () => {
        const state = active();
        assert.equal(apply(state, { type: 'room:leave', playerId: 'observer', reason: 'disconnect' }).state, state);
        const result = apply(state, { type: 'room:leave', playerId: 'a', reason: 'room_leave' });
        assertReset(result.state);
        assert.ok(result.effects.some(effect => effect.type === 'broadcast' && effect.packet.event === 'game:quited'));
        assert.equal(apply(result.state, { type: 'deadline' }, { now: 999999 }).state, result.state);
        assert.deepEqual(apply(joined(), { type: 'room:leave', playerId: 'a', reason: 'room_leave' }).state.room.users.map(user => user.id), ['b']);
    });
    test(`${runtime}: bomb progresses 0→1→2→3→4 then ends and resets`, () => {
        let state = active();
        for (let status = 1; status <= 4; status++) {
            const before = state;
            assert.equal(apply(state, { type: 'deadline' }, { now: state.bombAt! - 1 }).state, state);
            state = apply(state, { type: 'deadline' }, { now: state.bombAt! }).state;
            assert.equal(state.room.bombStatus, status);
            assert.equal(state.room.isStart, true);
            assert.equal(state.bombAt, before.bombAt! + 20000);
            // A retry before the newly scheduled deadline cannot advance twice.
            assert.equal(apply(state, { type: 'deadline' }, { now: before.bombAt! }).state, state);
        }
        const result = apply(state, { type: 'deadline' }, { now: state.bombAt! });
        assertReset(result.state);
        assert.ok(result.effects.some(effect => effect.type === 'broadcast' && effect.packet.event === 'game:end' && effect.packet.data.holderUserId === 'a'));
    });
    test(`${runtime}: the core does not mutate input or retain mutable players`, () => {
        const state = joined();
        const original = structuredClone(state);
        const result = apply(state, start);
        assert.deepEqual(state, original);
        result.state.room.users[0].displayName = 'changed';
        assert.deepEqual(state, original);
    });
}
function assertReset(state: GameState) {
    assert.equal(state.room.isStart, false);
    assert.deepEqual(state.room.users, []);
    assert.equal(state.room.gameId, undefined);
    assert.equal(state.room.wordIndex, undefined);
    assert.equal(state.room.bombHolder, 0);
    assert.equal(state.room.bombStatus, 0);
    assert.equal(state.wordAt, undefined);
    assert.equal(state.bombAt, undefined);
}
test('preserves existing runtime differences explicitly', () => {
    const state = fresh();
    state.room.users = [{ id: 'a' }, { id: 'b' }];
    for (const rules of [NODE_GAME_RULES, WORKER_GAME_RULES]) {
        const context = { now: 0, random: () => 0, rules };
        const spectator = applyGameEvent(state, { ...start, playerId: 'observer' }, context);
        assert.equal(spectator.state.room.isStart, rules.allowSpectatorStart);
        const started = applyGameEvent(state, start, context).state;
        const passed = applyGameEvent(started, { type: 'word:success', playerId: 'a' }, context).state;
        assert.equal(passed.room.bombHolder, rules.allowCountdownPass ? 1 : 0);
    }
});
test('validates names, auth payloads, health IDs, and typing data', () => {
    for (const name of [null, '', 'x'.repeat(51), 'x\n', 'x\u200b']) assert.throws(() => validateDisplayName(name));
    assert.equal(validateDisplayName('猫 Player'), '猫 Player');
    assert.throws(() => parseClientEvent('auth:response', { jwtToken: 1, displayName: 'a' }));
    assert.throws(() => parseClientEvent('auth:response', { jwtToken: 'token', displayName: '\n' }));
    assert.deepEqual(parseClientEvent('auth:response', { jwtToken: 'token', displayName: 'a' }), { event: 'auth:response', data: { jwtToken: 'token', displayName: 'a' } });
    assert.equal(parseClientEvent('currentInput', {}), null);
    assert.equal(parseClientEvent('health:ping', 'invalid'), null);
    assert.equal(parseClientEvent('__proto__', undefined), null);
    assert.deepEqual(parseClientEvent('room:join', { ignored: true }), { event: 'room:join', data: undefined });
    assert.throws(() => requireRoomItems({ items: [] }));
});
test('wire snapshot preserves legacy words and hides passwords and internal deadlines', () => {
    const state = fresh();
    state.room.password = 'secret';
    state.wordAt = 3000;
    const wire = roomSnapshot(state.room);
    assert.equal('password' in wire, false);
    assert.equal('wordAt' in wire, false);
    assert.deepEqual(wire.words, state.room.items.map(item => ({ jp: item.prompt, en: item.answer })));
});
