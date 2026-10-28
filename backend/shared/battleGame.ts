import type { Item } from "./types";

/** Minimal, transport-independent two-player battle prototype. */
export type BattlePlayer = { id: string; hp: number; combo: number };
export type BattleState = {
    players: [BattlePlayer, BattlePlayer];
    currentPlayerId: string;
    question: Item;
    turn: number;
    status: "playing" | "finished";
    winnerId: string | null;
    lastAttack: { attackerId: string; targetId: string; word: string } | null;
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
export const BATTLE_COMBO_BONUS = 5;
export const BATTLE_MAX_DAMAGE = 35;
export const BATTLE_COUNTER_HEAL = 10;

export function createBattle(
    playerIds: [string, string],
    question: Item,
): BattleState {
    if (playerIds[0] === playerIds[1])
        throw new Error("Players must be distinct");
    if (!question.answer.trim())
        throw new Error("Question answer must not be empty");
    return {
        players: playerIds.map((id) => ({ id, hp: BATTLE_START_HP, combo: 0 })) as [
            BattlePlayer,
            BattlePlayer,
        ],
        currentPlayerId: playerIds[0],
        question,
        turn: 1,
        status: "playing",
        winnerId: null,
        lastAttack: null,
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
    const newCombo = attacker.combo + 1;
    const damage = Math.min(BATTLE_MAX_DAMAGE, BATTLE_ATTACK_DAMAGE + (newCombo - 1) * BATTLE_COMBO_BONUS);
    const counter = state.lastAttack?.attackerId === defender.id &&
        state.lastAttack.targetId === attacker.id &&
        state.lastAttack.word === action.answer;
    const newHp = Math.max(0, defender.hp - damage);
    const finished = newHp === 0;
    return {
        accepted: true,
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === defender.id ? { ...p, hp: newHp } :
                p.id === attacker.id ? { ...p, combo: newCombo, hp: Math.min(BATTLE_START_HP, p.hp + (counter ? BATTLE_COUNTER_HEAL : 0)) } : { ...p },
            ) as [BattlePlayer, BattlePlayer],
            currentPlayerId: finished ? attacker.id : defender.id,
            question: finished ? state.question : nextQuestion,
            turn: state.turn + 1,
            status: finished ? "finished" : "playing",
            winnerId: finished ? attacker.id : null,
            lastAttack: { attackerId: attacker.id, targetId: defender.id, word: action.answer },
        },
    };
}
