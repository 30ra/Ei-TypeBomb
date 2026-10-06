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
    "encoding" | "free_recall" | "cued_recall" | "relearned";

export type RecallObservation = RecallProgress & {
    success: boolean;
    answerLength: number;
    firstAttemptCorrect: boolean;
    outcome?: RecallOutcome;
    finalCueRatio?: number;
    initialCueRatio?: number;
    additionalHintCount?: number;
    reviewContext?: "scheduled" | "early_extra";
    elapsedSincePresentationMs?: number;
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
    learningState?: PersistedLearningState | null;
    lastPresentedAt?: string | null;
};

export type LearningMode =
    "encoding" | "supported_recall" | "free_recall" | "relearning";

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
    practiceAttempts?: number;
    deferred?: boolean;
};

const INITIAL_ENCODING_STABILITY = 0.15;
const FAILURE_PENALTY = 0.55;
const LOW_CUE_THRESHOLD = 0.2;
const CUE_STEPS = [0.2, 0.4, 0.7, 1] as const;
export const MAX_ACTIVE_LEARNING_ITEMS = 4;
export const MIN_INTERVENING_TURNS = 4;
export const MAX_PRACTICE_ATTEMPTS_PER_BLOCK = 10;
export const MEMORY_MODEL_VERSION = "playground-v3";

export type PersistedLearningState = Pick<
    SessionLearningState,
    | "phase"
    | "freeRecallSuccesses"
    | "lastCueRatio"
    | "relearningSinceLastFreeRecall"
    | "cueSuccessStreak"
>;

export const restoreSessionLearning = (
    memory: ItemMemoryState | undefined,
    turn: number,
): SessionLearningState => ({
    phase:
        memory?.learningState?.phase ??
        ((memory?.reviewCount ?? 0) === 0 ? "encoding" : "supported_recall"),
    freeRecallSuccesses: memory?.learningState?.freeRecallSuccesses ?? 0,
    lastFreeRecallTurn:
        (memory?.learningState?.freeRecallSuccesses ?? 0) > 0 ? turn : null,
    lastSeenTurn: turn,
    lastCueRatio: memory?.learningState?.lastCueRatio ?? 0.5,
    relearningSinceLastFreeRecall:
        memory?.learningState?.relearningSinceLastFreeRecall ?? false,
    cueSuccessStreak: memory?.learningState?.cueSuccessStreak ?? 0,
});

export const persistSessionLearning = (
    state: SessionLearningState,
): PersistedLearningState => ({
    phase: state.phase,
    freeRecallSuccesses: state.freeRecallSuccesses,
    lastCueRatio: state.lastCueRatio,
    relearningSinceLastFreeRecall: state.relearningSinceLastFreeRecall,
    cueSuccessStreak: state.cueSuccessStreak,
});

const advanceLearningPhase = (
    current: SessionLearningState,
    observation: RecallObservation,
    turn: number,
): SessionLearningState => {
    const ratio =
        observation.finalCueRatio ??
        observation.revealedHintChars / Math.max(1, observation.answerLength);
    const failed = !observation.success || observation.outcome === "relearned";
    if (observation.outcome === "encoding") {
        return {
            ...current,
            phase: "supported_recall",
            lastSeenTurn: turn,
            lastCueRatio: 0.5,
            cueSuccessStreak: 0,
        };
    }
    if (failed) {
        return {
            ...current,
            phase: "supported_recall",
            freeRecallSuccesses: 0,
            lastFreeRecallTurn: null,
            lastSeenTurn: turn,
            lastCueRatio: 0.6,
            cueSuccessStreak: 0,
            relearningSinceLastFreeRecall: true,
        };
    }
    if (observation.reviewContext === "early_extra") {
        return { ...current, lastSeenTurn: turn };
    }
    if (ratio === 0) {
        const separated =
            current.lastFreeRecallTurn === null ||
            turn - current.lastFreeRecallTurn > MIN_INTERVENING_TURNS ||
            (observation.elapsedSincePresentationMs ?? 0) >= 30_000;
        const successes = separated
            ? current.freeRecallSuccesses + 1
            : current.freeRecallSuccesses;
        return {
            ...current,
            phase: successes >= 2 ? "graduated" : "free_recall",
            freeRecallSuccesses: successes,
            lastFreeRecallTurn: separated ? turn : current.lastFreeRecallTurn,
            lastSeenTurn: turn,
            lastCueRatio: 0,
            cueSuccessStreak: 0,
            relearningSinceLastFreeRecall: false,
        };
    }
    // Advance the requested cue stage, rather than the rounded character ratio.
    // Extra hints indicate that the current stage still needs practice.
    const requestedCue = observation.initialCueRatio ?? current.lastCueRatio;
    const supported =
        requestedCue > 0 && (observation.additionalHintCount ?? 0) === 0;
    const streak = supported ? current.cueSuccessStreak + 1 : 0;
    const nextCue =
        streak >= 2
            ? requestedCue > 0.4
                ? 0.4
                : requestedCue > 0.2
                  ? 0.2
                  : 0
            : requestedCue;
    return {
        ...current,
        phase: nextCue === 0 ? "free_recall" : "supported_recall",
        freeRecallSuccesses: 0,
        lastFreeRecallTurn: null,
        lastSeenTurn: turn,
        lastCueRatio: supported ? nextCue : Math.min(0.7, Math.max(0.2, ratio)),
        cueSuccessStreak: streak >= 2 ? 0 : streak,
        relearningSinceLastFreeRecall: false,
    };
};

// Rotation is independent of mastery: needing hints must not block the rest of the room.
export const updateSessionLearning = (
    current: SessionLearningState,
    observation: RecallObservation,
    turn: number,
): SessionLearningState => {
    const next = advanceLearningPhase(current, observation, turn);
    const practiceAttempts = (current.practiceAttempts ?? 0) + 1;
    return {
        ...next,
        practiceAttempts,
        deferred:
            next.phase !== "graduated" &&
            practiceAttempts >= MAX_PRACTICE_ATTEMPTS_PER_BLOCK,
    };
};

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
    learning_state?: PersistedLearningState | null;
    last_presented_at?: string | null;
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
    learningState: row.learning_state ?? null,
    lastPresentedAt: row.last_presented_at ?? null,
});

export const createInitialMemory = (
    userId: string,
    roomId: string,
    itemId: string,
): ItemMemoryState => ({
    userId,
    roomId,
    itemId,
    stability: INITIAL_ENCODING_STABILITY,
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

export const getReviewContext = (
    memory: ItemMemoryState | undefined,
    phase: SessionLearningState["phase"] | undefined,
    previousPresentationTurn: number | undefined,
    currentTurn: number,
    now = Date.now(),
): "scheduled" | "early_extra" => {
    if (!memory || memory.reviewCount === 0) return "scheduled";
    if (phase === "graduated" && getRetrievability(memory, now) >= 0.8)
        return "early_extra";
    const lastExposure = memory.lastPresentedAt ?? memory.lastReviewedAt;
    const elapsed = lastExposure ? now - Date.parse(lastExposure) : Infinity;
    // Time can provide spacing for very small sets with no intervening items.
    // Thirty seconds is a conservative heuristic, not a proven optimal interval.
    const spacedTurns =
        previousPresentationTurn !== undefined &&
        currentTurn - previousPresentationTurn > MIN_INTERVENING_TURNS;
    return spacedTurns || elapsed >= 30_000 ? "scheduled" : "early_extra";
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
    const current = memory ?? createInitialMemory(userId, roomId, itemId);
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
        stability = Math.max(0.12, current.stability * FAILURE_PENALTY);
        nextDifficulty = clamp(difficulty + 0.7, 1, 10);
    } else if (observation.reviewContext !== "early_extra") {
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
        // No fixed gain at zero delay; coefficients remain a testable heuristic.
        const spacingGain = (1 - retrievability) * 2;
        const difficultyDrag = 1 - ((difficulty - 1) / 9) * 0.25;
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
                (outcome === "free_recall" && observation.firstAttemptCorrect
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
        lastReviewedAt:
            observation.reviewContext === "early_extra" &&
            observation.success &&
            outcome !== "relearned"
                ? current.lastReviewedAt
                : isoNow,
        lastPresentedAt: isoNow,
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
            : 0.25 + forgettingRisk * 0.75 + difficultyNormalized * 0.25;

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

    const cooldown = new Set(recentItemIds.slice(-3));
    const notRecentlySeen = (item: Item) => !cooldown.has(item.id);

    // Bot turns are rhythm-only: never introduce an unseen word.
    if (!activeRecall) {
        const seenItems = items.filter(
            (item) => (memoryByItem[item.id]?.reviewCount ?? 0) > 0,
        );
        if (seenItems.length === 0) return null;

        const graduated = seenItems.filter(
            (item) =>
                sessionByItem[item.id]?.phase === "graduated" ||
                (!sessionByItem[item.id] &&
                    memoryByItem[item.id]?.learningState?.phase ===
                        "graduated"),
        );
        if (graduated.length === 0) {
            // Repeat the user's last answer, rather than revealing their upcoming retrieval target.
            const latest = [...recentItemIds]
                .reverse()
                .find((id) => seenItems.some((item) => item.id === id));
            return seenItems.find((item) => item.id === latest) ?? seenItems[0];
        }
        const botPool =
            graduated.filter(notRecentlySeen).length > 0
                ? graduated.filter(notRecentlySeen)
                : graduated;
        return [...botPool].sort(
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
        )[0];
    }

    const activeStates = Object.values(sessionByItem).filter(
        (state) => state.phase !== "graduated" && !state.deferred,
    );
    const activeCount = activeStates.length;

    // Fill the active block before repeating due items. Otherwise three items
    // with alternating BOT turns are always due and starve the fourth item.
    if (activeCount < MAX_ACTIVE_LEARNING_ITEMS) {
        const unseenInSession = items.find(
            (item) =>
                !sessionByItem[item.id] &&
                notRecentlySeen(item) &&
                memoryByItem[item.id]?.learningState?.phase !== "graduated",
        );
        if (unseenInSession) return unseenInSession;
        const deferred = items
            .filter(
                (item) =>
                    sessionByItem[item.id]?.deferred && notRecentlySeen(item),
            )
            .sort(
                (a, b) =>
                    sessionByItem[a.id].lastSeenTurn -
                    sessionByItem[b.id].lastSeenTurn,
            );
        if (deferred.length > 0) return deferred[0];
    }

    const dueSessionItems = items
        .filter((item) => {
            const state = sessionByItem[item.id];
            if (!state || state.phase === "graduated" || state.deferred)
                return false;
            return (
                currentTurnNumber - state.lastSeenTurn >= MIN_INTERVENING_TURNS
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

            const graduatedThisSession = session?.phase === "graduated";
            const persistedLongTermCandidate =
                !session && memory.learningState?.phase === "graduated";

            if (!graduatedThisSession && !persistedLongTermCandidate) {
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

    // Never stop play just because nothing is due. Reuse the best
    // available learned/active item as an early-extra review.
    const nonActiveNotRecent = items.filter((item) => {
        const session = sessionByItem[item.id];
        return (
            notRecentlySeen(item) &&
            (session?.phase === "graduated" ||
                (!session &&
                    memoryByItem[item.id]?.learningState?.phase ===
                        "graduated"))
        );
    });
    const admitted = items.filter(
        (item) =>
            (sessionByItem[item.id] && !sessionByItem[item.id].deferred) ||
            memoryByItem[item.id]?.learningState?.phase === "graduated",
    );
    const notRecent = admitted.filter(notRecentlySeen);
    const fallbackPool =
        nonActiveNotRecent.length > 0
            ? nonActiveNotRecent
            : notRecent.length > 0
              ? notRecent
              : admitted.length > 0
                ? admitted
                : items;

    const lastSeenIndex = (itemId: string) => recentItemIds.lastIndexOf(itemId);

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
    const timeAdjustment = Math.round((difficulty - 5) * 600);

    if (
        session?.phase === "encoding" ||
        (!session && (memory?.reviewCount ?? 0) === 0)
    ) {
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
        const initialCueRatio = clamp(session.lastCueRatio, 0.2, 0.7);
        return {
            mode: "supported_recall",
            retrievalWindowMs: clamp(22_000 + timeAdjustment, 15_000, 28_000),
            retrievability,
            difficulty,
            initialCueRatio,
            cueSteps: CUE_STEPS.filter((ratio) => ratio > initialCueRatio),
            stallMs: 2_500,
            bombPressure: "low",
            countsAsRecall: true,
        };
    }

    if (session?.phase === "free_recall") {
        return {
            mode: "free_recall",
            retrievalWindowMs: clamp(18_000 + timeAdjustment, 12_000, 26_000),
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
            retrievalWindowMs: clamp(24_000 + timeAdjustment, 18_000, 30_000),
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
            retrievalWindowMs: clamp(22_000 + timeAdjustment, 15_000, 28_000),
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
        retrievalWindowMs: clamp(18_000 + timeAdjustment, 12_000, 26_000),
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
        .map((item) => createTurnPlan(memoryByItem[item.id]).retrievalWindowMs)
        .filter((duration) => duration > 0)
        .sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] ?? 18_000;

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

    if (userReviewCount < 4 || items.length === 0) return false;
    return items.every(
        (item) =>
            memoryByItem[item.id]?.learningState?.phase === "graduated" &&
            getRetrievability(memoryByItem[item.id], now) >= 0.8,
    );
};
