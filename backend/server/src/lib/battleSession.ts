import type { Item } from "../../../shared/types";
import { applyBattleAction, createBattle, type BattleState } from "../../../shared/battleGame";
import { createScheduler, chooseNextUserItem, recordUserAnswer, type SchedulerState, type ItemMemoryState } from "../../../shared/scheduler";
import { evaluateRecall, type RecallObservation } from "../../../shared/recallEvaluation";

type Player = { id: string; name: string };
type Session = { players: Player[]; battle: BattleState | null; deck: Item[]; scheduler: SchedulerState; memories: Record<string, Record<string, ItemMemoryState>>; revision: number };
export type PublicBattle = {
    players: { id: string; name: string; hp: number; combo: number }[];
    currentPlayerId: string | null;
    question: Item | null;
    turn: number;
    wordsCompleted: number;
    countersUsed: number;
    noHintStreak: number;
    incomingWords: string[];
    status: "waiting" | "playing" | "finished";
    winnerId: string | null;
    revision: number;
};
const sessions = new Map<string, Session>();
const get = (roomId: string, items: Item[]) => {
    let session = sessions.get(roomId);
    if (!session) {
        const deck = items.filter(item => item.type === "typed_recall" && item.answer.trim());
        session = { players: [], battle: null, deck, scheduler: createScheduler(deck.map((_, index) => String(index))), memories: {}, revision: 0 };
        sessions.set(roomId, session);
    }
    return session;
};
export function joinBattle(roomId: string, items: Item[], id: string, name: string) {
    const session = get(roomId, items);
    if (!session.players.some(player => player.id === id)) {
        if (session.players.length >= 2 || session.battle) return false;
        session.players.push({ id, name: name.slice(0, 32) || "Player" });
        session.revision++;
    }
    return true;
}
export function startBattle(roomId: string, id: string) {
    const session = sessions.get(roomId);
    if (!session || session.battle || session.players.length !== 2 || session.players[0].id !== id || session.deck.length === 0) return false;
    const first = chooseNextUserItem(session.scheduler, session.memories[id] ?? {});
    if (!first) return false;
    session.battle = createBattle([session.players[0].id, session.players[1].id], session.deck[Number(first.itemId)]);
    session.revision++;
    return true;
}
export function answerBattle(roomId: string, id: string, payload: unknown) {
    const session = sessions.get(roomId);
    if (!session?.battle || !payload || typeof payload !== "object") return false;
    const data = payload as Record<string, unknown>;
    if (typeof data.answer !== "string" || data.answer.length > 128 || !Number.isInteger(data.turn) || !Number.isInteger(data.wordIndex) || (data.mode !== "normal" && data.mode !== "counter")) return false;
    const battle = session.battle;
    // A server-validated answer never trusts the client's hint-use claim.
    // Until hint telemetry is authenticated, all online answers count as assisted.
    const current = session.scheduler.current;
    const result = applyBattleAction(battle, {
        type: "battle:answer", playerId: id, answer: data.answer,
        expectedTurn: data.turn as number, expectedWordIndex: data.wordIndex as number,
        mode: data.mode, hintUsed: true,
    }, battle.question);
    if (!result.accepted) return false;
    session.battle = result.state;
    if (data.mode === "normal" && current) {
        // Client hint and timing reports are untrusted; do not infer mastery.
        // Client-reported speed and hints are not trusted as proof of mastery.
        // Use the original evaluation model with a conservative observation.
        const observation: RecallObservation = {
            success: true, answerLength: battle.question.answer.length,
            firstAttemptCorrect: false, revealedHintChars: 0, hintCount: 0,
            attemptCount: 2, incorrectInputCount: 1,
            elapsedMs: 12000, recallLatencyMs: null,
            elapsedSincePresentationMs: 0,
        };
        const evaluation = evaluateRecall(observation);
        recordUserAnswer(session.scheduler, evaluation);
        const previous = session.memories[id]?.[current.itemId];
        const now = new Date().toISOString();
        // No long-term mastery gain without independently verified recall telemetry.
        session.memories[id] ??= {};
        session.memories[id][current.itemId] = {
            stability: previous?.stability ?? 0.15,
            difficulty: previous?.difficulty ?? 5,
            reviewCount: (previous?.reviewCount ?? 0) + 1,
            lastReviewedAt: previous?.lastReviewedAt ?? null,
        };
        if (result.state.status === "playing") {
            const next = chooseNextUserItem(session.scheduler, session.memories[result.state.currentPlayerId] ?? {});
            if (next) session.battle = { ...result.state, question: session.deck[Number(next.itemId)] };
        }
    }
    session.revision++;
    return true;
}
export function leaveBattle(roomId: string, id: string) {
    const session = sessions.get(roomId);
    if (!session) return;
    if (session.battle && session.battle.status === "playing") {
        const opponent = session.players.find(player => player.id !== id);
        session.battle = { ...session.battle, status: "finished", winnerId: opponent?.id ?? null };
    }
    session.players = session.players.filter(player => player.id !== id);
    session.revision++;
    if (session.players.length === 0) sessions.delete(roomId);
}
export function battleSnapshot(roomId: string): PublicBattle | null {
    const session = sessions.get(roomId);
    if (!session) return null;
    const battle = session.battle;
    return {
        players: session.players.map(player => ({ ...player, hp: battle?.players.find(p => p.id === player.id)?.hp ?? 100, combo: battle?.players.find(p => p.id === player.id)?.combo ?? 0 })),
        currentPlayerId: battle?.currentPlayerId ?? null,
        question: battle?.question ?? null,
        turn: battle?.turn ?? 0,
        wordsCompleted: battle?.wordsCompleted ?? 0,
        countersUsed: battle?.countersUsed ?? 0,
        noHintStreak: battle?.noHintStreak ?? 0,
        incomingWords: battle?.incomingWords ?? [],
        status: battle?.status ?? "waiting",
        winnerId: battle?.winnerId ?? null,
        revision: session.revision,
    };
}
