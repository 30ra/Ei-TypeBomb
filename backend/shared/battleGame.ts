import type { Item } from "./types";

/** Pure battle rules. The runtime must authenticate players and track hint use. */
export type BattlePlayer = { id: string; hp: number; combo: number };
export type BattleState = {
    players: [BattlePlayer, BattlePlayer];
    currentPlayerId: string;
    question: Item;
    turn: number;
    wordsCompleted: number;
    countersUsed: number;
    noHintStreak: number;
    incomingWords: string[];
    outgoingWords: string[];
    status: "playing" | "finished";
    winnerId: string | null;
};
export type BattleAction = {
    type: "battle:answer";
    playerId: string;
    answer: string;
    expectedTurn: number;
    expectedWordIndex: number;
    mode: "normal" | "counter";
    /** Set by trusted server-side hint tracking, not client input. */
    hintUsed: boolean;
};
export type BattleResult = {
    state: BattleState;
    accepted: boolean;
    reason?: "not_your_turn" | "wrong_answer" | "stale_turn" | "finished" | "counter_unavailable";
    damage?: number;
    healed?: number;
};
export const BATTLE_START_HP = 100;
export const BATTLE_ATTACK_DAMAGE = 20;
export const BATTLE_COMBO_BONUS = 5;
export const BATTLE_MAX_DAMAGE = 35;
export const BATTLE_COUNTER_HEAL = 10;
export const BATTLE_WORDS_PER_TURN = 5;
export const BATTLE_MAX_COUNTERS_PER_TURN = 3;
export const BATTLE_COUNTER_STREAK_REQUIRED = 2;

export function createBattle(playerIds: [string, string], question: Item): BattleState {
    if (playerIds[0] === playerIds[1]) throw new Error("Players must be distinct");
    if (!question.answer.trim()) throw new Error("Question answer must not be empty");
    return {
        players: playerIds.map((id) => ({ id, hp: BATTLE_START_HP, combo: 0 })) as [BattlePlayer, BattlePlayer],
        currentPlayerId: playerIds[0],
        question,
        turn: 1,
        wordsCompleted: 0,
        countersUsed: 0,
        noHintStreak: 0,
        incomingWords: [],
        outgoingWords: [],
        status: "playing",
        winnerId: null,
    };
}

/**
 * A counter uses a word from the opponent's immediately preceding turn.
 * Each answer consumes one of the five word slots. A successful counter
 * requires a two-answer no-hint streak (including this answer).
 */
export function applyBattleAction(state: BattleState, action: BattleAction, nextQuestion: Item): BattleResult {
    const reject = (reason: NonNullable<BattleResult["reason"]>): BattleResult =>
        ({ state, accepted: false, reason });
    if (state.status !== "playing") return reject("finished");
    if (action.expectedTurn !== state.turn || action.expectedWordIndex !== state.wordsCompleted)
        return reject("stale_turn");
    if (action.playerId !== state.currentPlayerId) return reject("not_your_turn");
    const attacker = state.players.find((p) => p.id === action.playerId);
    const defender = state.players.find((p) => p.id !== action.playerId);
    if (!attacker || !defender) return reject("not_your_turn");

    const counter = action.mode === "counter";
    if (counter && (state.countersUsed >= BATTLE_MAX_COUNTERS_PER_TURN ||
        state.noHintStreak < BATTLE_COUNTER_STREAK_REQUIRED - 1 ||
        action.hintUsed || !state.incomingWords.includes(action.answer)))
        return reject("counter_unavailable");
    if (!counter && action.answer !== state.question.answer) {
        return { state: { ...state, noHintStreak: 0, players: state.players.map(
            (p) => p.id === attacker.id ? { ...p, combo: 0 } : { ...p },
        ) as [BattlePlayer, BattlePlayer] }, accepted: false, reason: "wrong_answer" };
    }

    const combo = attacker.combo + 1;
    const normalDamage = Math.min(BATTLE_MAX_DAMAGE, BATTLE_ATTACK_DAMAGE + (combo - 1) * BATTLE_COMBO_BONUS);
    const damage = counter ? Math.floor(normalDamage / 2) : normalDamage;
    const healed = counter ? Math.min(BATTLE_COUNTER_HEAL, BATTLE_START_HP - attacker.hp) : 0;
    const defenderHp = Math.max(0, defender.hp - damage);
    const finished = defenderHp === 0;
    const wordsCompleted = state.wordsCompleted + 1;
    const turnEnds = wordsCompleted >= BATTLE_WORDS_PER_TURN;
    const incomingWords = counter
        ? state.incomingWords.filter((word, index) => index !== state.incomingWords.indexOf(action.answer))
        : state.incomingWords;
    const outgoingWords = [...state.outgoingWords, action.answer];
    return {
        accepted: true, damage, healed,
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === defender.id ? { ...p, hp: defenderHp } :
                p.id === attacker.id ? { ...p, hp: p.hp + healed, combo } : { ...p },
            ) as [BattlePlayer, BattlePlayer],
            currentPlayerId: turnEnds && !finished ? defender.id : attacker.id,
            question: finished ? state.question : nextQuestion,
            turn: turnEnds && !finished ? state.turn + 1 : state.turn,
            wordsCompleted: turnEnds ? 0 : wordsCompleted,
            countersUsed: turnEnds ? 0 : state.countersUsed + (counter ? 1 : 0),
            noHintStreak: turnEnds ? 0 : action.hintUsed ? 0 : state.noHintStreak + 1,
            incomingWords: turnEnds ? outgoingWords : incomingWords,
            outgoingWords: turnEnds ? [] : outgoingWords,
            status: finished ? "finished" : "playing",
            winnerId: finished ? attacker.id : null,
        },
    };
}
