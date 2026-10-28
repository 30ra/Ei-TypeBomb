import type { Item } from "./types";

/** Minimal, transport-independent two-player battle prototype. */
export type BattlePlayer = { id: string; hp: number };
export type BattleState = {
    players: [BattlePlayer, BattlePlayer];
    currentPlayerId: string;
    question: Item;
    turn: number;
    status: "playing" | "finished";
    winnerId: string | null;
};
export type BattleAction = {
    type: "battle:answer";
    playerId: string;
    answer: string;
    expectedTurn: number;
};
export type BattleResult = {
    state: BattleState;
    accepted: boolean;
    reason?: "not_your_turn" | "wrong_answer" | "stale_turn" | "finished";
};
export const BATTLE_START_HP = 100;
export const BATTLE_ATTACK_DAMAGE = 20;

export function createBattle(
    playerIds: [string, string],
    question: Item,
): BattleState {
    if (playerIds[0] === playerIds[1])
        throw new Error("Players must be distinct");
    if (!question.answer.trim())
        throw new Error("Question answer must not be empty");
    return {
        players: playerIds.map((id) => ({ id, hp: BATTLE_START_HP })) as [
            BattlePlayer,
            BattlePlayer,
        ],
        currentPlayerId: playerIds[0],
        question,
        turn: 1,
        status: "playing",
        winnerId: null,
    };
}

/**
 * Server must supply authenticated playerId, never a client-provided identity.
 * The answer is checked against the server-owned question.
 */
export function applyBattleAction(
    state: BattleState,
    action: BattleAction,
    nextQuestion: Item,
): BattleResult {
    const reject = (reason: NonNullable<BattleResult["reason"]>): BattleResult =>
        ({ state, accepted: false, reason });
    if (state.status !== "playing") return reject("finished");
    if (action.expectedTurn !== state.turn) return reject("stale_turn");
    if (action.playerId !== state.currentPlayerId) return reject("not_your_turn");
    if (action.answer !== state.question.answer) return reject("wrong_answer");
    const attacker = state.players.find((p) => p.id === action.playerId);
    const defender = state.players.find((p) => p.id !== action.playerId);
    if (!attacker || !defender) return reject("not_your_turn");
    const newHp = Math.max(0, defender.hp - BATTLE_ATTACK_DAMAGE);
    const finished = newHp === 0;
    return {
        accepted: true,
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === defender.id ? { ...p, hp: newHp } : { ...p },
            ) as [BattlePlayer, BattlePlayer],
            currentPlayerId: finished ? attacker.id : defender.id,
            question: finished ? state.question : nextQuestion,
            turn: state.turn + 1,
            status: finished ? "finished" : "playing",
            winnerId: finished ? attacker.id : null,
        },
    };
}
