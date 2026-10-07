import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeGameAdapter } from '../src/lib/gameAdapter';
import type { GameEffect } from '../../shared/game';
import type { GameState } from '../../shared/types';

const fresh = (): GameState => ({ room: {
    id: 'room', users: [{ id: 'a' }, { id: 'b' }], items: [{ id: 'item', type: 'typed_recall', prompt: '猫', answer: 'cat' }],
    maxPlayers: 2, gameDuration: 1, isStart: false, bombStatus: 0, bombHolder: 0,
} });
test('Node adapter uses absolute deadlines for countdown and every bomb phase', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const effects: GameEffect[] = [];
    const adapter = new NodeGameAdapter(fresh(), result => effects.push(...result.effects), Date.now, () => 0);
    t.after(() => adapter.dispose());
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'game', gameDuration: 1 });
    assert.equal(adapter.state.wordAt, 4000);
    assert.equal(adapter.state.bombAt, 2000);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.bombStatus, 1);
    assert.equal(adapter.state.room.wordIndex, undefined);
    t.mock.timers.tick(1000);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.wordIndex, 0);
    assert.equal(adapter.state.room.bombStatus, 3);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.bombStatus, 4);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.isStart, false);
    assert.deepEqual(adapter.state.room.users, []);
    assert.equal(adapter.state.bombAt, undefined);
    assert.ok(effects.some(effect => effect.type === 'broadcast' && effect.packet.event === 'game:end'));
});
test('Node adapter cancels stale timers on leave and schedules a new game independently', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const adapter = new NodeGameAdapter(fresh(), () => {}, Date.now, () => 0);
    t.after(() => adapter.dispose());
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'old', gameDuration: 20 });
    t.mock.timers.tick(1000);
    adapter.apply({ type: 'room:leave', playerId: 'a', reason: 'room_leave' });
    adapter.apply({ type: 'room:join', player: { id: 'a' } });
    adapter.apply({ type: 'room:join', player: { id: 'b' } });
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'new', gameDuration: 20 });
    t.mock.timers.tick(2000);
    assert.equal(adapter.state.room.wordIndex, undefined);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.wordIndex, 0);
    assert.equal(adapter.state.room.gameId, 'new');
    adapter.apply({ type: 'room:leave', playerId: 'a', reason: 'disconnect' });
    const stopped = structuredClone(adapter.state);
    t.mock.timers.tick(100000);
    assert.deepEqual(adapter.state, stopped);
});
