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

export type RecallObservation = RecallProgress & {
    success: boolean;
    answerLength: number;
    firstAttemptCorrect: boolean;
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

export type TurnPlan = {
    retrievalWindowMs: number;
    hintIntervalsMs: number[];
    retrievability: number;
    difficulty: number;
};

const BASE_HINT_INTERVALS_MS = [6_000, 4_000, 3_000, 2_500];

export const toMemoryState = (row: {
    user_id: string;
    room_id: string;
    item_id: string;
    stability: number;
    difficulty: number;
    review_count: number;
    last_reviewed_at: string;
    created_at?: string | null;
    updated_at?: string | null;
}): ItemMemoryState => ({
    userId: row.user_id,
    roomId: row.room_id,
    itemId: row.item_id,
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
    const difficultyNormalized = (difficulty - 1) / 9;
    const hintBurden = clamp(
        observation.hintCount /
            Math.max(1, Math.ceil(observation.answerLength / 3)),
        0,
        1,
    );
    const prefixRatio = clamp(
        observation.maxCorrectPrefixLength /
            Math.max(1, observation.answerLength),
        0,
        1,
    );
    const latencyPenalty =
        observation.recallLatencyMs === null
            ? 0
            : clamp((observation.recallLatencyMs - 3_000) / 12_000, 0, 1);

    let stability = current.stability;
    let nextDifficulty = difficulty;

    if (observation.success) {
        const quality = clamp(
            1 -
                hintBurden * 0.55 -
                latencyPenalty * 0.15 +
                prefixRatio * 0.1,
            0.2,
            1,
        );
        const spacingGain = 0.7 + (1 - retrievability) * 1.6;
        const difficultyDrag = 1 - difficultyNormalized * 0.25;

        if (current.reviewCount === 0) {
            stability = 0.45 + quality * 0.75;
        } else {
            stability = Math.max(
                0.12,
                stability *
                    (1 + spacingGain * quality * difficultyDrag),
            );
        }

        nextDifficulty = clamp(
            difficulty +
                hintBurden * 0.6 +
                latencyPenalty * 0.25 -
                (observation.firstAttemptCorrect &&
                observation.hintCount === 0
                    ? 0.35
                    : 0),
            1,
            10,
        );
    } else {
        stability = Math.max(0.12, stability * 0.6);
        nextDifficulty = clamp(difficulty + 0.8, 1, 10);
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
}: {
    items: Item[];
    memoryByItem: Record<string, ItemMemoryState>;
    recentItemIds: string[];
    activeRecall: boolean;
}) => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];

    const cooldown = new Set(recentItemIds.slice(-3));
    const availableItems = items.some((item) => !cooldown.has(item.id))
        ? items.filter((item) => !cooldown.has(item.id))
        : items;

    const ranked = availableItems
        .map((item) => ({
            item,
            score: getItemPriority({
                item,
                memory: memoryByItem[item.id],
                recentItemIds,
            }),
        }))
        .sort((a, b) =>
            activeRecall ? b.score - a.score : a.score - b.score,
        );

    return ranked[0]?.item ?? null;
};

export const createTurnPlan = (
    memory: ItemMemoryState | undefined,
): TurnPlan => {
    const retrievability = getRetrievability(memory);
    const difficulty = memory?.difficulty ?? 5;
    const difficultyNormalized = (difficulty - 1) / 9;
    const supportNeed =
        (1 - retrievability) * 0.55 + difficultyNormalized * 0.45;

    const timingScale = clamp(0.9 + supportNeed * 0.25, 0.9, 1.15);
    const hintIntervalsMs = BASE_HINT_INTERVALS_MS.map((interval) =>
        Math.round(interval * timingScale),
    );
    const retrievalWindowMs = Math.round(
        clamp(
            15_000 +
                difficultyNormalized * 5_000 +
                (1 - retrievability) * 3_000,
            15_000,
            24_000,
        ),
    );

    return {
        retrievalWindowMs,
        hintIntervalsMs,
        retrievability,
        difficulty,
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
