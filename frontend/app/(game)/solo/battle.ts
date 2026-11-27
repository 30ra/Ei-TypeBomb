export const WORDS_PER_ENEMY = 3;
const ANSWER_RECOVERY_MS = 3000;
const TIME_VARIATION_MS = 750;
const PASS_MS = 550;
const DEFEAT_MS = 450;
const BOT_KEY_MS = 110;
const BOT_WORD_PAUSE_MS = 350;

export type EnemyWord = { itemId: string; frames: string[] };

export type Battle = {
    phase: "ready" | "preparing" | "armed" | "incoming" | "typing" | "returning" | "defeated" | "over";
    deadline: number;
    remaining: number;
    timeLimit: number;
    defeated: number;
    question: number;
    correct: number;
    enemyWords: EnemyWord[];
    nextEnemyWords: EnemyWord[];
    enemyWord: number;
    enemyFrame: number;
};

type Action =
    | { type: "start"; now: number; enemyWords: EnemyWord[] }
    | { type: "tick"; now: number; random: number }
    | { type: "answer"; now: number; question: number; nextEnemyWords: EnemyWord[] };

export const initialBattle: Battle = {
    phase: "ready",
    deadline: 0,
    remaining: 0,
    timeLimit: 0,
    defeated: 0,
    question: 0,
    correct: 0,
    enemyWords: [],
    nextEnemyWords: [],
    enemyWord: 0,
    enemyFrame: 0,
};

function rollTimeLimit(defeated: number, random: number) {
    const base = Math.max(8000, 18000 - defeated * 500);
    const variation = Math.round((random * 2 - 1) * TIME_VARIATION_MS);
    return Math.max(8000, base + variation);
}

export function battleReducer(battle: Battle, action: Action): Battle {
    const { now } = action;
    if (action.type === "start") {
        return {
            ...initialBattle,
            phase: "preparing",
            deadline: now + BOT_KEY_MS,
            enemyWords: action.enemyWords,
        };
    }

    if (battle.phase === "typing" && now >= battle.deadline) {
        return { ...battle, phase: "over", remaining: 0 };
    }

    if (action.type === "answer") {
        if (battle.phase !== "typing" || action.question !== battle.question) return battle;
        const correct = battle.correct + 1;
        const remaining = Math.min(
            battle.timeLimit,
            battle.deadline - now + ANSWER_RECOVERY_MS,
        );
        return {
            ...battle,
            phase: "returning",
            deadline: now + PASS_MS,
            remaining,
            question: battle.question + 1,
            correct,
            nextEnemyWords: action.nextEnemyWords,
        };
    }

    if (battle.phase === "typing") {
        return { ...battle, remaining: battle.deadline - now };
    }
    if (now < battle.deadline) return battle;
    switch (battle.phase) {
        case "preparing": {
            const { frames } = battle.enemyWords[battle.enemyWord];
            if (battle.enemyFrame < frames.length) {
                const enemyFrame = battle.enemyFrame + 1;
                return {
                    ...battle,
                    enemyFrame,
                    deadline: now + (enemyFrame === frames.length ? BOT_WORD_PAUSE_MS : BOT_KEY_MS),
                };
            }
            if (battle.enemyWord + 1 < battle.enemyWords.length) {
                return {
                    ...battle,
                    enemyWord: battle.enemyWord + 1,
                    enemyFrame: 0,
                    deadline: now + BOT_KEY_MS,
                };
            }
            return { ...battle, phase: "armed", deadline: now + PASS_MS };
        }
        case "armed":
            return { ...battle, phase: "incoming", deadline: now + PASS_MS };
        case "incoming": {
            const timeLimit = battle.timeLimit || rollTimeLimit(battle.defeated, action.random);
            const remaining = battle.timeLimit ? battle.remaining : timeLimit;
            return { ...battle, phase: "typing", timeLimit, remaining, deadline: now + remaining };
        }
        case "returning":
            return battle.correct === WORDS_PER_ENEMY
                ? {
                      ...battle,
                      phase: "defeated",
                      deadline: now + DEFEAT_MS,
                      defeated: battle.defeated + 1,
                  }
                : { ...battle, phase: "incoming", deadline: now + PASS_MS };
        case "defeated":
            return {
                ...battle,
                phase: "preparing",
                deadline: now + BOT_KEY_MS,
                correct: 0,
                timeLimit: 0,
                remaining: 0,
                enemyWords: battle.nextEnemyWords,
                nextEnemyWords: [],
                enemyWord: 0,
                enemyFrame: 0,
            };
        default:
            return battle;
    }
}
