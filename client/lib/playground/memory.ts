import type { Item } from "@/type";

const DAY_MS = 86_400_000;

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

export type RecallProgress = {
    attemptCount: number;
    hintCount: number;
    revealedHintChars: number;
    maxCorrectPrefixLength: number;
    recallLatencyMs: number | null;
    elapsedMs: number;
};

export type RecallOutcome =
    | "encoding"
    | "free_recall"
    | "cued_recall"
    | "relearned";

export type RecallObservation = RecallProgress & {
    success: boolean;
    answerLength: number;
    firstAttemptCorrect: boolean;
    outcome?: RecallOutcome;
    finalCueRatio?: number;
};

export type ItemMemoryState = {
    userId: string;
    roomId: string;
    itemId: string;
    stability: number;
    difficulty: number;
    reviewCount: number;
    lastReviewedAt: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type LearningMode =
    | "encoding"
    | "supported_recall"
    | "free_recall"
    | "relearning";

export type TurnPlan = {
    mode: LearningMode;
    retrievalWindowMs: number;
    retrievability: number;
    difficulty: number;
    initialCueRatio: number;
    cueSteps: number[];
    stallMs: number | null;
    bombPressure: "paused" | "low" | "normal";
    countsAsRecall: boolean;
};

export type SessionLearningState = {
    phase: "encoding" | "supported_recall" | "free_recall" | "graduated";
    freeRecallSuccesses: number;
    lastFreeRecallTurn: number | null;
    lastSeenTurn: number;
    lastCueRatio: number;
    relearningSinceLastFreeRecall: boolean;
    cueSuccessStreak: number;
};

const INITIAL_ENCODING_STABILITY = 0.15;
const RELEARNING_ENCODING_GAIN = 0.15;
const FAILURE_PENALTY = 0.55;
const LOW_CUE_THRESHOLD = 0.2;
const CUE_STEPS = [0.2, 0.4, 0.7, 1] as const;
const MAX_ACTIVE_LEARNING_ITEMS = 4;
const MIN_INTERVENING_TURNS = 4;
const MIN_REVIEWS_BEFORE_LONG_TERM = 5;

export const toMemoryState = (row: {
    user_id: string;
    room_id: string;
    id: string;
    stability: number;
    difficulty: number;
    review_count: number;
    last_reviewed_at: string;
    created_at?: string | null;
    updated_at?: string | null;
}): ItemMemoryState => ({
    userId: row.user_id,
    roomId: row.room_id,
    itemId: row.id,
    stability: Math.max(0.12, Number(row.stability) || 0.35),
    difficulty: clamp(Number(row.difficulty) || 5, 1, 10),
    reviewCount: Math.max(0, Number(row.review_count) || 0),
    lastReviewedAt: row.last_reviewed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
});

export const createInitialMemory = (
    userId: string,
    roomId: string,
    itemId: string,
): ItemMemoryState => ({
    userId,
    roomId,
    itemId,
    stability: 0.35,
    difficulty: 5,
    reviewCount: 0,
    lastReviewedAt: null,
});

export const getRetrievability = (
    memory: ItemMemoryState | undefined,
    now = Date.now(),
) => {
    if (!memory?.lastReviewedAt || memory.reviewCount === 0) return 0;

    const elapsedDays = Math.max(
        0,
        (now - new Date(memory.lastReviewedAt).getTime()) / DAY_MS,
    );
    const stability = Math.max(0.12, memory.stability);

    return clamp(Math.exp(-elapsedDays / stability), 0, 1);
};

export const applyRecallObservation = ({
    memory,
    observation,
    userId,
    roomId,
    itemId,
    now = new Date(),
}: {
    memory: ItemMemoryState | undefined;
    observation: RecallObservation;
    userId: string;
    roomId: string;
    itemId: string;
    now?: Date;
}): ItemMemoryState => {
    const current =
        memory ?? createInitialMemory(userId, roomId, itemId);
    const retrievability = getRetrievability(current, now.getTime());
    const difficulty = clamp(current.difficulty, 1, 10);
    const finalCueRatio = clamp(
        observation.finalCueRatio ??
            observation.revealedHintChars /
                Math.max(1, observation.answerLength),
        0,
        1,
    );
    const outcome: RecallOutcome =
        observation.outcome ??
        (current.reviewCount === 0
            ? "encoding"
            : observation.success
              ? finalCueRatio === 0
                  ? "free_recall"
                  : finalCueRatio >= 1
                    ? "relearned"
                    : "cued_recall"
              : "relearned");

    let stability = current.stability;
    let nextDifficulty = difficulty;

    if (outcome === "encoding") {
        stability = Math.max(
            current.reviewCount === 0
                ? INITIAL_ENCODING_STABILITY
                : current.stability,
            INITIAL_ENCODING_STABILITY,
        );
        nextDifficulty = difficulty;
    } else if (outcome === "relearned" || !observation.success) {
        stability = Math.max(
            0.12,
            current.stability * FAILURE_PENALTY +
                RELEARNING_ENCODING_GAIN,
        );
        nextDifficulty = clamp(difficulty + 0.7, 1, 10);
    } else {
        const recallWeight =
            finalCueRatio === 0
                ? 1
                : finalCueRatio <= LOW_CUE_THRESHOLD
                  ? 0.7
                  : finalCueRatio <= 0.4
                    ? 0.45
                    : finalCueRatio <= 0.7
                      ? 0.2
                      : 0.05;
        const spacingGain = 0.55 + (1 - retrievability) * 1.45;
        const difficultyDrag =
            1 - ((difficulty - 1) / 9) * 0.25;
        const attemptPenalty = clamp(
            1 - (observation.attemptCount - 1) * 0.12,
            0.55,
            1,
        );

        stability = Math.max(
            0.12,
            current.stability *
                (1 +
                    spacingGain *
                        recallWeight *
                        difficultyDrag *
                        attemptPenalty),
        );

        nextDifficulty = clamp(
            difficulty +
                (1 - recallWeight) * 0.35 -
                (outcome === "free_recall" &&
                observation.firstAttemptCorrect
                    ? 0.35
                    : 0),
            1,
            10,
        );
    }

    const isoNow = now.toISOString();

    return {
        ...current,
        userId,
        roomId,
        itemId,
        stability,
        difficulty: nextDifficulty,
        reviewCount: current.reviewCount + 1,
        lastReviewedAt: isoNow,
        updatedAt: isoNow,
    };
};
export const getItemPriority = ({
    item,
    memory,
    recentItemIds,
    now = Date.now(),
}: {
    item: Item;
    memory: ItemMemoryState | undefined;
    recentItemIds: string[];
    now?: number;
}) => {
    const retrievability = getRetrievability(memory, now);
    const difficulty = memory?.difficulty ?? 5;
    const difficultyNormalized = (difficulty - 1) / 9;
    const forgettingRisk = 1 - retrievability;

    const base =
        !memory || memory.reviewCount === 0
            ? 1.3
            : 0.25 +
              forgettingRisk * 0.75 +
              difficultyNormalized * 0.25;

    const recentDistance = [...recentItemIds]
        .reverse()
        .findIndex((id) => id === item.id);

    const diversityFactor =
        recentDistance === -1
            ? 1
            : recentDistance === 0
              ? 0.05
              : recentDistance <= 2
                ? 0.2
                : recentDistance <= 4
                  ? 0.6
                  : 1;

    return base * diversityFactor;
};

export const chooseNextItem = ({
    items,
    memoryByItem,
    recentItemIds,
    activeRecall,
    sessionByItem = {},
    currentTurnNumber = 0,
}: {
    items: Item[];
    memoryByItem: Record<string, ItemMemoryState>;
    recentItemIds: string[];
    activeRecall: boolean;
    sessionByItem?: Record<string, SessionLearningState>;
    currentTurnNumber?: number;
}) => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];

    const cooldown = new Set(recentItemIds.slice(-3));
    const notRecentlySeen = (item: Item) => !cooldown.has(item.id);

    // Bot turns are rhythm-only: never introduce an unseen word.
    if (!activeRecall) {
        const seenItems = items.filter(
            (item) => (memoryByItem[item.id]?.reviewCount ?? 0) > 0,
        );
        if (seenItems.length === 0) return null;

        const botPool =
            seenItems.filter(notRecentlySeen).length > 0
                ? seenItems.filter(notRecentlySeen)
                : seenItems;

        return (
            [...botPool]
                .sort(
                    (a, b) =>
                        getItemPriority({
                            item: a,
                            memory: memoryByItem[a.id],
                            recentItemIds,
                        }) -
                        getItemPriority({
                            item: b,
                            memory: memoryByItem[b.id],
                            recentItemIds,
                        }),
                )[0] ?? items[0]
        );
    }

    const activeStates = Object.values(sessionByItem).filter(
        (state) => state.phase !== "graduated",
    );
    const activeCount = activeStates.length;

    const dueSessionItems = items
        .filter((item) => {
            const state = sessionByItem[item.id];
            if (!state || state.phase === "graduated") return false;
            return (
                currentTurnNumber - state.lastSeenTurn >=
                MIN_INTERVENING_TURNS
            );
        })
        .sort((a, b) => {
            const aState = sessionByItem[a.id];
            const bState = sessionByItem[b.id];
            return aState.lastSeenTurn - bState.lastSeenTurn;
        });

    if (dueSessionItems.length > 0) {
        return dueSessionItems[0];
    }


    const dueLongTermItems = items
        .filter((item) => {
            const session = sessionByItem[item.id];
            const memory = memoryByItem[item.id];
            if (!memory) return false;

            const graduatedThisSession =
                session?.phase === "graduated";
            const persistedLongTermCandidate =
                !session &&
                memory.reviewCount >= MIN_REVIEWS_BEFORE_LONG_TERM;

            if (
                !graduatedThisSession &&
                !persistedLongTermCandidate
            ) {
                return false;
            }

            return getRetrievability(memory) < 0.8;
        })
        .filter(notRecentlySeen)
        .map((item) => ({
            item,
            score: getItemPriority({
                item,
                memory: memoryByItem[item.id],
                recentItemIds,
            }),
        }))
        .sort((a, b) => b.score - a.score);

    if (dueLongTermItems.length > 0) {
        return dueLongTermItems[0].item;
    }

    if (activeCount < MAX_ACTIVE_LEARNING_ITEMS) {
        const unfinished = items.find((item) => {
            if (
                sessionByItem[item.id] ||
                !notRecentlySeen(item)
            ) {
                return false;
            }

            const reviewCount =
                memoryByItem[item.id]?.reviewCount ?? 0;
            return reviewCount < MIN_REVIEWS_BEFORE_LONG_TERM;
        });
        if (unfinished) return unfinished;
    }

    // Never stop play just because nothing is due. Reuse the best
    // available learned/active item as an early-extra review.
    const nonActiveNotRecent = items.filter((item) => {
        const session = sessionByItem[item.id];
        return (
            notRecentlySeen(item) &&
            (!session || session.phase === "graduated")
        );
    });
    const notRecent = items.filter(notRecentlySeen);
    const fallbackPool =
        nonActiveNotRecent.length > 0
            ? nonActiveNotRecent
            : notRecent.length > 0
              ? notRecent
              : items;

    const lastSeenIndex = (itemId: string) =>
        recentItemIds.lastIndexOf(itemId);

    return (
        [...fallbackPool]
            .map((item) => ({
                item,
                lastSeenIndex: lastSeenIndex(item.id),
                score: getItemPriority({
                    item,
                    memory: memoryByItem[item.id],
                    recentItemIds,
                }),
            }))
            .sort((a, b) => {
                if (a.lastSeenIndex !== b.lastSeenIndex) {
                    return a.lastSeenIndex - b.lastSeenIndex;
                }
                return b.score - a.score;
            })[0]?.item ?? items[0]
    );
};
export const createTurnPlan = (
    memory: ItemMemoryState | undefined,
    session?: SessionLearningState,
): TurnPlan => {
    const retrievability = getRetrievability(memory);
    const difficulty = memory?.difficulty ?? 5;

    if (session?.phase === "encoding" || (!memory && !session)) {
        return {
            mode: "encoding",
            retrievalWindowMs: 0,
            retrievability: 0,
            difficulty,
            initialCueRatio: 1,
            cueSteps: [1],
            stallMs: null,
            bombPressure: "paused",
            countsAsRecall: false,
        };
    }

    if (session?.phase === "supported_recall") {
        const initialCueRatio = clamp(
            session.lastCueRatio || 0.5,
            0.2,
            0.7,
        );
        return {
            mode: "supported_recall",
            retrievalWindowMs: 22_000,
            retrievability,
            difficulty,
            initialCueRatio,
            cueSteps: CUE_STEPS.filter(
                (ratio) => ratio > initialCueRatio,
            ),
            stallMs: 2_500,
            bombPressure: "low",
            countsAsRecall: true,
        };
    }

    if (session?.phase === "free_recall") {
        return {
            mode: "free_recall",
            retrievalWindowMs: 18_000,
            retrievability,
            difficulty,
            initialCueRatio: 0,
            cueSteps: [...CUE_STEPS],
            stallMs: 4_000,
            bombPressure: "normal",
            countsAsRecall: true,
        };
    }

    // Existing/graduated items are scheduled only by the long-term model.
    if (retrievability < 0.35) {
        return {
            mode: "relearning",
            retrievalWindowMs: 24_000,
            retrievability,
            difficulty,
            initialCueRatio: 0.6,
            cueSteps: [0.7, 1],
            stallMs: 2_500,
            bombPressure: "low",
            countsAsRecall: true,
        };
    }

    if (retrievability < 0.72) {
        return {
            mode: "supported_recall",
            retrievalWindowMs: 22_000,
            retrievability,
            difficulty,
            initialCueRatio: 0.2,
            cueSteps: CUE_STEPS.filter((ratio) => ratio > 0.2),
            stallMs: 2_500,
            bombPressure: "low",
            countsAsRecall: true,
        };
    }

    return {
        mode: "free_recall",
        retrievalWindowMs: 18_000,
        retrievability,
        difficulty,
        initialCueRatio: 0,
        cueSteps: [...CUE_STEPS],
        stallMs: 4_000,
        bombPressure: "normal",
        countsAsRecall: true,
    };
};
export const getAdaptiveBombStageDurationMs = ({
    items,
    memoryByItem,
}: {
    items: Item[];
    memoryByItem: Record<string, ItemMemoryState>;
}) => {
    if (items.length === 0) return 18_000;

    const durations = items
        .map((item) =>
            createTurnPlan(memoryByItem[item.id]).retrievalWindowMs,
        )
        .filter((duration) => duration > 0)
        .sort((a, b) => a - b);
    const median =
        durations[Math.floor(durations.length / 2)] ?? 18_000;

    return clamp(median, 15_000, 24_000);
};

export const shouldRecommendStop = ({
    items,
    memoryByItem,
    userReviewCount,
    sessionStartedAt,
    now = Date.now(),
}: {
    items: Item[];
    memoryByItem: Record<string, ItemMemoryState>;
    userReviewCount: number;
    sessionStartedAt: number;
    now?: number;
}) => {
    if (now - sessionStartedAt >= 15 * 60_000) return true;

    const minimumReviews = Math.min(
        Math.max(4, items.length),
        8,
    );
    if (userReviewCount < minimumReviews) return false;

    const highestRemainingValue = Math.max(
        ...items.map((item) =>
            getItemPriority({
                item,
                memory: memoryByItem[item.id],
                recentItemIds: [],
                now,
            }),
        ),
        0,
    );

    return highestRemainingValue < 0.48;
};
