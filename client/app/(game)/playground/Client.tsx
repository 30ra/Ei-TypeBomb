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
    getAdaptiveBombStageDurationMs,
    shouldRecommendStop,
    type ItemMemoryState,
    type RecallObservation,
    type RecallProgress,
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
    { id: "playground-bot-1", displayName: "練習相手1" },
    { id: "playground-bot-2", displayName: "練習相手2" },
];

const BOT_TYPING = {
    "playground-bot-1": { initialDelay: 600, charDelay: 220 },
    "playground-bot-2": { initialDelay: 800, charDelay: 300 },
} as const;

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
            maxPlayers: 3,
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

    const recentItemIdsRef = useRef<string[]>([]);
    const recallProgressRef = useRef<RecallProgress | null>(null);
    const userReviewCountRef = useRef(0);
    const sessionStartedAtRef = useRef(Date.now());
    const initialGameStartedRef = useRef(false);
    const countdownTimerRef = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const usersRef = useRef(users);

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

        if (item) {
            recentItemIdsRef.current = [
                ...recentItemIdsRef.current,
                item.id,
            ].slice(-12);
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

    const updateLocalMemory = useCallback(
        (
            item: Item,
            observation: RecallObservation,
        ) => {
            const userId = authenticatedUserIdRef.current;
            if (!userId) return;

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
                stability_after: nextMemory.stability,
                difficulty_after: nextMemory.difficulty,
            });
        },
        [room.id],
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

    const handleSuccess = useCallback(() => {
        if (successAudioRef.current && initialSounDeffects) {
            successAudioRef.current.currentTime = 0;
            successAudioRef.current.volume = 1;
            successAudioRef.current.play().catch(() => {});
        }

        setCurrentInput("");

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

    useEffect(() => {
        if (
            !memoryReady ||
            !isStarted ||
            result !== null
        ) {
            return;
        }

        const baseDuration = getAdaptiveBombStageDurationMs({
            items,
            memoryByItem: memoryByItemRef.current,
        });
        const duration = Math.round(
            baseDuration * (0.94 + Math.random() * 0.12),
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
    ]);

    const currentTurnUser = users[currentTurn];

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

        const config =
            BOT_TYPING[
                currentTurnUser.id as keyof typeof BOT_TYPING
            ];
        if (!config) return;

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
                timer = setTimeout(
                    typeNextCharacter,
                    config.charDelay,
                );
                return;
            }

            timer = setTimeout(() => {
                if (!cancelled) handleSuccess();
            }, 200);
        };

        timer = setTimeout(
            typeNextCharacter,
            config.initialDelay,
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

    const hintIntervalsMs = useMemo(() => {
        if (
            currentTurnUser?.id !== LOCAL_USER_ID ||
            !currentItem
        ) {
            return undefined;
        }

        return createTurnPlan(
            memoryByItem[currentItem.id],
        ).hintIntervalsMs;
    }, [
        currentItem,
        currentTurnUser?.id,
        memoryByItem,
    ]);

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
            onChangeInput={setCurrentInput}
            onRecallProgress={handleRecallProgress}
            onRecallComplete={handleRecallComplete}
            hintIntervalsMs={hintIntervalsMs}
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
