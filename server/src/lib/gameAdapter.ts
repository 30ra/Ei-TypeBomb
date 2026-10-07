import { applyGameEvent, nextGameDeadline, type GameRules, type GameEvent, type GameResult } from '../shared/game';
import type { GameState } from '../shared/types';

export const NODE_GAME_RULES: GameRules = { allowSpectatorStart: true, allowCountdownPass: true, clearInputOnStop: false };

// Socket.IO and logging are supplied by index.ts; timer handles never enter GameState.
export class NodeGameAdapter {
    private timer?: ReturnType<typeof setTimeout>;
    constructor(
        public state: GameState,
        private readonly onResult: (result: GameResult, previous: GameState) => void,
        private readonly now = Date.now,
        private readonly random = Math.random,
    ) { this.schedule(); }
    apply(event: GameEvent): GameResult {
        const previous = this.state;
        const result = applyGameEvent(previous, event, { now: this.now(), random: this.random, rules: NODE_GAME_RULES });
        this.state = result.state;
        if (previous.wordAt !== result.state.wordAt || previous.bombAt !== result.state.bombAt || previous.room.gameId !== result.state.room.gameId) this.schedule();
        this.onResult(result, previous);
        return result;
    }
    private schedule() {
        this.dispose();
        const deadline = nextGameDeadline(this.state);
        if (deadline === undefined) return;
        const gameId = this.state.room.gameId;
        this.timer = setTimeout(() => {
            if (this.state.room.gameId === gameId) this.apply({ type: 'deadline' });
        }, Math.max(1, Math.ceil(deadline - this.now())));
    }
    dispose() {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
}
