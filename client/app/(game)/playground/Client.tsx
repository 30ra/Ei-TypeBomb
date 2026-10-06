"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Item, Position, Room, User } from "@/type";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import Button from "@/components/ui/Button";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import {
    applyRecallObservation,
    chooseNextItem,
    createTurnPlan,
    shouldRecommendStop,
    type ItemMemoryState,
    type RecallObservation,
    type RecallProgress,
    type SessionLearningState,
} from "@/lib/playground/memory";
import {
    loadPlaygroundMemory,
    syncPlaygroundMemory,
} from "@/lib/playground/memory-client";

type Props = {
    room: Room;
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const LOCAL_USER_ID = "playground-player";
const BOT_USERS: User[] = [
    { id: "playground-bot-1", displayName: "練習相手" },
];

const DEFAULT_TYPING_DELAY_MS = 220;
const MIN_TYPING_DELAY_MS = 80;
const MAX_TYPING_DELAY_MS = 600;
const TYPING_SPEED_SMOOTHING = 0.3;

const clampTypingDelay = (delayMs: number) =>
    Math.min(
        MAX_TYPING_DELAY_MS,
        Math.max(MIN_TYPING_DELAY_MS, delayMs),
    );

export default function Client({
    room: sourceRoom,
    initialBackgroundMusic,
    initialSounDeffects,
}: Readonly<Props>) {
    const router = useRouter();
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();

    const [displayName, setDisplayName] = useState("あなた");
    const users = useMemo<User[]>(
        () => [
            { id: LOCAL_USER_ID, displayName },
            ...BOT_USERS,
        ],
        [displayName],
    );
    const room = useMemo<Room>(
        () => ({
            ...sourceRoom,
            maxPlayers: 2,
        }),
        [sourceRoom],
    );
    const items = useMemo(() => room.items ?? [], [room.items]);

    const [memoryByItem, setMemoryByItem] = useState<
        Record<string, ItemMemoryState>
    >({});
    const memoryByItemRef = useRef<Record<string, ItemMemoryState>>(
        {},
    );
    const pendingMemoryRef = useRef(
        new Map<string, ItemMemoryState>(),
    );
    const authenticatedUserIdRef = useRef<string | null>(null);
    const [memoryReady, setMemoryReady] = useState(false);
    const [memoryError, setMemoryError] = useState<string | null>(
        null,
    );

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const currentItemRef = useRef<Item | null>(null);
    const [currentTurn, setCurrentTurn] = useState(0);
    const currentTurnRef = useRef(0);
    const [bombStatus, setBombStatus] = useState(0);
    const [isStarted, setIsStarted] = useState(false);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [lostDisplayName, setLostDisplayName] = useState<
        string | null
    >(null);
    const [stopRecommended, setStopRecommended] = useState(false);
    const [recallPressurePaused, setRecallPressurePaused] =
        useState(false);

    const recentItemIdsRef = useRef<string[]>([]);
    const sessionByItemRef = useRef<Record<string, SessionLearningState>>(
        {},
    );
    const [sessionByItem, setSessionByItem] = useState<
        Record<string, SessionLearningState>
    >({});
    const sessionTurnNumberRef = useRef(0);
    const recallProgressRef = useRef<RecallProgress | null>(null);
    const userReviewCountRef = useRef(0);
    const sessionStartedAtRef = useRef(Date.now());
    const initialGameStartedRef = useRef(false);
    const countdownTimerRef = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const usersRef = useRef(users);
    const userTypingDelayRef = useRef(DEFAULT_TYPING_DELAY_MS);
    const previousInputAtRef = useRef<number | null>(null);
    const previousInputLengthRef = useRef(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const successAudioRef = useRef<HTMLAudioElement | null>(null);

    const userPositions = useMemo<Position[]>(
        () =>
            newPositions(
                users,
                Array.from({ length: users.length }, () => ({
                    x: 0,
                    y: 0,
                    w: 24,
                    h: 24,
                    opacity: 0,
                })),
            ),
        [users],
    );

    useEffect(() => {
        setDisplayName(
            localStorage.getItem("display-name") || "あなた",
        );
    }, []);

    useEffect(() => {
        usersRef.current = users;
    }, [users]);

    useEffect(() => {
        let cancelled = false;

        const loadMemory = async () => {
            const loaded = await loadPlaygroundMemory(room.id);
            if (cancelled) return;

            if (!loaded.userId) {
                router.replace(
                    getSignInUrl(),
                );
                return;
            }

            if (loaded.error) {
                console.error(
                    "Failed to load playground memory",
                    loaded.error,
                );
                posthog.capture("playground_memory_load_failed", {
                    room_id: room.id,
                });
                setMemoryError(
                    "学習データを取得できませんでした。もう一度お試しください。",
                );
                return;
            }

            authenticatedUserIdRef.current = loaded.userId;
            memoryByItemRef.current = loaded.memoryByItem;
            setMemoryByItem(loaded.memoryByItem);
            setMemoryReady(true);
        };

        void loadMemory();

        return () => {
            cancelled = true;
        };
    }, [room.id, router]);

    const setTrackedItem = useCallback((item: Item | null) => {
        currentItemRef.current = item;
        setCurrentItem(item);
        recallProgressRef.current = null;
        setRecallPressurePaused(false);

        if (item) {
            sessionTurnNumberRef.current += 1;
            recentItemIdsRef.current = [
                ...recentItemIdsRef.current,
                item.id,
            ].slice(-12);

            const isLocalTurn =
                usersRef.current[currentTurnRef.current]?.id ===
                LOCAL_USER_ID;
            const memory = memoryByItemRef.current[item.id];

            if (
                isLocalTurn &&
                !sessionByItemRef.current[item.id] &&
                (!memory || memory.reviewCount === 0)
            ) {
                const nextSessionState: SessionLearningState = {
                    phase: "encoding",
                    freeRecallSuccesses: 0,
                    lastFreeRecallTurn: null,
                    lastSeenTurn: sessionTurnNumberRef.current,
                    lastCueRatio: 1,
                    relearningSinceLastFreeRecall: false,
                    cueSuccessStreak: 0,
                };
                sessionByItemRef.current = {
                    ...sessionByItemRef.current,
                    [item.id]: nextSessionState,
                };
                setSessionByItem(sessionByItemRef.current);
            }
        }
    }, []);

    const chooseItemForTurn = useCallback(
        (turnIndex: number) =>
            chooseNextItem({
                items,
                memoryByItem: memoryByItemRef.current,
                recentItemIds: recentItemIdsRef.current,
                activeRecall:
                    usersRef.current[turnIndex]?.id === LOCAL_USER_ID,
                sessionByItem: sessionByItemRef.current,
                currentTurnNumber: sessionTurnNumberRef.current,
            }),
        [items],
    );

    const setTrackedTurn = useCallback((turnIndex: number) => {
        currentTurnRef.current = turnIndex;
        setCurrentTurn(turnIndex);
    }, []);

    const startGame = useCallback(() => {
        if (!memoryReady || items.length === 0) return;

        if (countdownTimerRef.current) {
            clearTimeout(countdownTimerRef.current);
        }

        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);
        setStopRecommended(false);
        setTrackedItem(null);

        const firstTurn = Math.floor(
            Math.random() * usersRef.current.length,
        );
        setTrackedTurn(firstTurn);

        countdownTimerRef.current = setTimeout(() => {
            setTrackedItem(chooseItemForTurn(firstTurn));
            countdownTimerRef.current = null;
        }, 3000);
    }, [
        chooseItemForTurn,
        items.length,
        memoryReady,
        resetExplosion,
        setTrackedItem,
        setTrackedTurn,
    ]);

    useEffect(() => {
        successAudioRef.current = new Audio("/Blip_select_8.wav");

        return () => {
            if (countdownTimerRef.current) {
                clearTimeout(countdownTimerRef.current);
            }
            successAudioRef.current?.pause();
        };
    }, []);

    useEffect(() => {
        if (
            !memoryReady ||
            initialGameStartedRef.current
        ) {
            return;
        }

        initialGameStartedRef.current = true;
        posthog.capture("playground_game_started", {
            room_id: room.id,
            player_count: users.length,
        });
        startGame();
    }, [
        memoryReady,
        room.id,
        startGame,
        users.length,
    ]);

    const updateSessionLearning = useCallback(
        (item: Item, observation: RecallObservation) => {
            const current = sessionByItemRef.current[item.id];
            const finalCueRatio =
                observation.finalCueRatio ??
                observation.revealedHintChars /
                    Math.max(1, observation.answerLength);
            const outcome =
                observation.outcome ??
                (observation.success
                    ? finalCueRatio === 0
                        ? "free_recall"
                        : finalCueRatio >= 1
                          ? "relearned"
                          : "cued_recall"
                    : "relearned");

            // Existing long-term items stay in the long-term scheduler
            // unless they genuinely fail and need relearning.
            if (
                !current &&
                outcome !== "encoding" &&
                outcome !== "relearned"
            ) {
                return;
            }

            let next: SessionLearningState =
                current ?? {
                    phase: "supported_recall",
                    freeRecallSuccesses: 0,
                    lastFreeRecallTurn: null,
                    lastSeenTurn: sessionTurnNumberRef.current,
                    lastCueRatio: 0.6,
                    relearningSinceLastFreeRecall: false,
                    cueSuccessStreak: 0,
                };

            if (outcome === "encoding") {
                next = {
                    ...next,
                    phase: "supported_recall",
                    freeRecallSuccesses: 0,
                    lastFreeRecallTurn: null,
                    lastSeenTurn: sessionTurnNumberRef.current,
                    lastCueRatio: 0.5,
                    relearningSinceLastFreeRecall: false,
                    cueSuccessStreak: 0,
                };
            } else if (
                outcome === "relearned" ||
                !observation.success
            ) {
                next = {
                    ...next,
                    phase: "supported_recall",
                    freeRecallSuccesses: 0,
                    lastFreeRecallTurn: null,
                    lastSeenTurn: sessionTurnNumberRef.current,
                    lastCueRatio: 0.6,
                    relearningSinceLastFreeRecall: true,
                    cueSuccessStreak: 0,
                };
            } else if (outcome === "cued_recall") {
                if (finalCueRatio <= 0.2) {
                    next = {
                        ...next,
                        phase: "free_recall",
                        freeRecallSuccesses: 0,
                        lastFreeRecallTurn: null,
                        lastSeenTurn: sessionTurnNumberRef.current,
                        lastCueRatio: 0,
                        relearningSinceLastFreeRecall: false,
                        cueSuccessStreak: 0,
                    };
                } else {
                    const streak = next.cueSuccessStreak + 1;
                    const canReduceCue = streak >= 2;
                    const reducedCue =
                        finalCueRatio > 0.4
                            ? 0.4
                            : finalCueRatio > 0.2
                              ? 0.2
                              : 0;

                    next = {
                        ...next,
                        phase:
                            canReduceCue && reducedCue === 0
                                ? "free_recall"
                                : "supported_recall",
                        freeRecallSuccesses: 0,
                        lastFreeRecallTurn: null,
                        lastSeenTurn: sessionTurnNumberRef.current,
                        lastCueRatio: canReduceCue
                            ? reducedCue
                            : finalCueRatio,
                        relearningSinceLastFreeRecall: false,
                        cueSuccessStreak: canReduceCue ? 0 : streak,
                    };
                }
            } else if (outcome === "free_recall") {
                const separatedEnough =
                    next.lastFreeRecallTurn === null ||
                    sessionTurnNumberRef.current -
                        next.lastFreeRecallTurn >=
                        4;
                const nextSuccesses =
                    separatedEnough &&
                    !next.relearningSinceLastFreeRecall
                        ? next.freeRecallSuccesses + 1
                        : 1;
                const graduated = nextSuccesses >= 2;

                next = {
                    ...next,
                    phase: graduated ? "graduated" : "free_recall",
                    freeRecallSuccesses: nextSuccesses,
                    lastFreeRecallTurn: sessionTurnNumberRef.current,
                    lastSeenTurn: sessionTurnNumberRef.current,
                    lastCueRatio: 0,
                    relearningSinceLastFreeRecall: false,
                    cueSuccessStreak: 0,
                };
            }

            sessionByItemRef.current = {
                ...sessionByItemRef.current,
                [item.id]: next,
            };
            setSessionByItem(sessionByItemRef.current);
        },
        [],
    );

    const updateLocalMemory = useCallback(
        (
            item: Item,
            observation: RecallObservation,
        ) => {
            const userId = authenticatedUserIdRef.current;
            if (!userId) return;

            updateSessionLearning(item, observation);

            const nextMemory = applyRecallObservation({
                memory: memoryByItemRef.current[item.id],
                observation,
                userId,
                roomId: room.id,
                itemId: item.id,
            });

            const nextMemoryByItem = {
                ...memoryByItemRef.current,
                [item.id]: nextMemory,
            };

            memoryByItemRef.current = nextMemoryByItem;
            setMemoryByItem(nextMemoryByItem);
            pendingMemoryRef.current.set(item.id, nextMemory);
            userReviewCountRef.current += 1;

            posthog.capture("playground_item_recalled", {
                room_id: room.id,
                item_id: item.id,
                success: observation.success,
                recall_latency_ms: observation.recallLatencyMs,
                hint_count: observation.hintCount,
                revealed_hint_chars:
                    observation.revealedHintChars,
                max_correct_prefix_length:
                    observation.maxCorrectPrefixLength,
                attempt_count: observation.attemptCount,
                recall_outcome: observation.outcome,
                final_cue_ratio: observation.finalCueRatio,
                session_phase_after:
                    sessionByItemRef.current[item.id]?.phase ??
                    "long_term",
                stability_after: nextMemory.stability,
                difficulty_after: nextMemory.difficulty,
            });
        },
        [room.id, updateSessionLearning],
    );

    const flushPendingMemory = useCallback(async () => {
        const snapshot = [
            ...pendingMemoryRef.current.values(),
        ];
        if (snapshot.length === 0) return;

        const error = await syncPlaygroundMemory(snapshot);

        if (error) {
            console.error(
                "Failed to sync playground memory",
                error,
            );
            posthog.capture("playground_memory_sync_failed", {
                room_id: room.id,
                item_count: snapshot.length,
            });
            return;
        }

        for (const synced of snapshot) {
            const current = pendingMemoryRef.current.get(
                synced.itemId,
            );
            if (current?.updatedAt === synced.updatedAt) {
                pendingMemoryRef.current.delete(synced.itemId);
            }
        }

        posthog.capture("playground_memory_synced", {
            room_id: room.id,
            item_count: snapshot.length,
        });
    }, [room.id]);

    const handleRecallProgress = useCallback(
        (progress: RecallProgress) => {
            if (
                usersRef.current[currentTurnRef.current]?.id !==
                LOCAL_USER_ID
            ) {
                return;
            }

            recallProgressRef.current = progress;
            const item = currentItemRef.current;
            if (
                item?.type === "typed_recall" &&
                progress.revealedHintChars >= item.answer.length
            ) {
                setRecallPressurePaused(true);
            }
        },
        [],
    );

    const handleRecallComplete = useCallback(
        (observation: RecallObservation) => {
            const item = currentItemRef.current;
            if (
                usersRef.current[currentTurnRef.current]?.id !==
                    LOCAL_USER_ID ||
                !item
            ) {
                return;
            }

            updateLocalMemory(item, observation);
        },
        [updateLocalMemory],
    );

    const handleInputChange = useCallback((input: string) => {
        const now = Date.now();
        const previousLength = previousInputLengthRef.current;
        const previousInputAt = previousInputAtRef.current;
        const addedCharacters = input.length - previousLength;

        if (addedCharacters > 0 && previousInputAt !== null) {
            const sampleDelay =
                (now - previousInputAt) / addedCharacters;

            if (sampleDelay > 0 && sampleDelay < 2000) {
                const clampedSample = clampTypingDelay(sampleDelay);
                userTypingDelayRef.current =
                    userTypingDelayRef.current *
                        (1 - TYPING_SPEED_SMOOTHING) +
                    clampedSample * TYPING_SPEED_SMOOTHING;
            }
        }

        previousInputLengthRef.current = input.length;
        previousInputAtRef.current =
            input.length === 0 ? null : now;
        setCurrentInput(input);
    }, []);

    const handleSuccess = useCallback(() => {
        if (successAudioRef.current && initialSounDeffects) {
            successAudioRef.current.currentTime = 0;
            successAudioRef.current.volume = 1;
            successAudioRef.current.play().catch(() => {});
        }

        setCurrentInput("");
        previousInputAtRef.current = null;
        previousInputLengthRef.current = 0;

        const nextTurn =
            (currentTurnRef.current + 1) %
            usersRef.current.length;
        setTrackedTurn(nextTurn);
        setTrackedItem(chooseItemForTurn(nextTurn));

        posthog.capture("word_succeeded", {
            mode: "playground",
            room_id: room.id,
        });
    }, [
        chooseItemForTurn,
        initialSounDeffects,
        room.id,
        setTrackedItem,
        setTrackedTurn,
    ]);

    const currentTurnUser = users[currentTurn];

    const currentTurnPlan = useMemo(() => {
        if (
            currentTurnUser?.id !== LOCAL_USER_ID ||
            !currentItem
        ) {
            return null;
        }

        return createTurnPlan(
            memoryByItem[currentItem.id],
            sessionByItem[currentItem.id],
        );
    }, [
        currentItem,
        currentTurnUser?.id,
        memoryByItem,
        sessionByItem,
    ]);

    useEffect(() => {
        if (
            !memoryReady ||
            !isStarted ||
            result !== null
        ) {
            return;
        }

        if (
            currentTurnPlan?.bombPressure === "paused" ||
            recallPressurePaused
        ) {
            return;
        }

        const baseDuration =
            currentTurnPlan?.retrievalWindowMs ?? 18_000;
        const pressureMultiplier =
            currentTurnPlan?.bombPressure === "low"
                ? 1.35
                : 1;
        const duration = Math.round(
            baseDuration *
                pressureMultiplier *
                (0.94 + Math.random() * 0.12),
        );

        const timer = setTimeout(() => {
            if (bombStatus === 4) {
                const lostUser =
                    usersRef.current[currentTurnRef.current];
                const didLose =
                    lostUser?.id === LOCAL_USER_ID;
                const item = currentItemRef.current;

                if (
                    didLose &&
                    item?.type === "typed_recall"
                ) {
                    const progress =
                        recallProgressRef.current ?? {
                            attemptCount: 1,
                            hintCount: 0,
                            revealedHintChars: 0,
                            maxCorrectPrefixLength: 0,
                            recallLatencyMs: null,
                            elapsedMs: duration,
                        };

                    updateLocalMemory(item, {
                        ...progress,
                        success: false,
                        answerLength: item.answer.length,
                        firstAttemptCorrect: false,
                    });
                }

                const recommendStop = shouldRecommendStop({
                    items,
                    memoryByItem: memoryByItemRef.current,
                    userReviewCount:
                        userReviewCountRef.current,
                    sessionStartedAt:
                        sessionStartedAtRef.current,
                });

                setStopRecommended(recommendStop);
                explode();
                setResult(didLose);
                setLostDisplayName(
                    lostUser?.displayName ?? "練習相手",
                );
                setBombStatus(0);

                posthog.capture(
                    didLose ? "game_lost" : "game_won",
                    {
                        mode: "playground",
                        room_id: room.id,
                        stop_recommended: recommendStop,
                    },
                );

                void flushPendingMemory();
                return;
            }

            setBombStatus((previous) => previous + 1);
        }, duration);

        return () => clearTimeout(timer);
    }, [
        bombStatus,
        explode,
        flushPendingMemory,
        isStarted,
        items,
        memoryReady,
        result,
        room.id,
        updateLocalMemory,
        currentTurnPlan,
        recallPressurePaused,
    ]);

    useEffect(() => {
        if (
            !isStarted ||
            result !== null ||
            !currentItem ||
            currentTurnUser?.id === LOCAL_USER_ID ||
            currentItem.type !== "typed_recall"
        ) {
            return;
        }

        const charDelay = clampTypingDelay(
            userTypingDelayRef.current,
        );
        const initialDelay = Math.min(
            1000,
            Math.max(250, charDelay * 2.5),
        );

        const target = currentItem.answer;
        let charIndex = 0;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const typeNextCharacter = () => {
            if (cancelled) return;

            if (charIndex < target.length) {
                charIndex += 1;
                setCurrentInput(
                    target.slice(0, charIndex),
                );
                const jitter = 0.9 + Math.random() * 0.2;
                timer = setTimeout(
                    typeNextCharacter,
                    Math.round(charDelay * jitter),
                );
                return;
            }

            timer = setTimeout(() => {
                if (!cancelled) handleSuccess();
            }, 200);
        };

        timer = setTimeout(
            typeNextCharacter,
            initialDelay,
        );

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [
        currentItem,
        currentTurnUser,
        handleSuccess,
        isStarted,
        result,
    ]);

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (!initialBackgroundMusic || !audioRef.current)
                return;

            audioRef.current
                .play()
                .then(removeListeners)
                .catch(() => {});
        };

        const addListeners = () => {
            window.addEventListener("click", startAudio);
            window.addEventListener(
                "touchstart",
                startAudio,
            );
            window.addEventListener(
                "keydown",
                startAudio,
            );
        };

        const removeListeners = () => {
            window.removeEventListener(
                "click",
                startAudio,
            );
            window.removeEventListener(
                "touchstart",
                startAudio,
            );
            window.removeEventListener(
                "keydown",
                startAudio,
            );
        };

        startAudio();
        addListeners();

        return () => {
            removeListeners();
            audioRef.current?.pause();
        };
    }, [initialBackgroundMusic]);

    const activeLearningPlan =
        currentTurnUser?.id === LOCAL_USER_ID
            ? currentTurnPlan
            : null;

    return (
        <GameView
            room={memoryReady ? room : null}
            users={users}
            positions={userPositions}
            userId={LOCAL_USER_ID}
            currentTurn={currentTurn}
            bombStatus={bombStatus}
            currentItem={currentItem}
            currentInput={currentInput}
            isStarted={isStarted}
            serverError={memoryError}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={handleInputChange}
            onRecallProgress={handleRecallProgress}
            onRecallComplete={handleRecallComplete}
            learningMode={activeLearningPlan?.mode}
            initialCueRatio={
                activeLearningPlan?.initialCueRatio
            }
            cueSteps={activeLearningPlan?.cueSteps}
            stallMs={activeLearningPlan?.stallMs}
            onPlayAgain={startGame}
            onCreateRoom={() =>
                router.push(
                    getSignInUrl(),
                )
            }
            enableRemoteTypingSync={false}
            stopRecommended={stopRecommended}
            onStop={() => {
                void flushPendingMemory().finally(() => {
                    router.push("/room");
                });
            }}
            resultExtraActions={
                <Button
                    iconName="link"
                    className="w-full"
                    onClick={() => router.push("/room")}
                >
                    別のルームを選択
                </Button>
            }
        />
    );
}
