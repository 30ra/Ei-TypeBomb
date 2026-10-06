"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Item, Position, Room, User } from "@/type";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import Button from "@/components/ui/Button";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";

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

const randomItem = (items: Item[]) =>
    items[Math.floor(Math.random() * items.length)] ?? null;

export default function Client({
    room: sourceRoom,
    initialBackgroundMusic,
    initialSounDeffects,
}: Readonly<Props>) {
    const router = useRouter();
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();

    const [displayName] = useState(() => {
        if (typeof window === "undefined") return "あなた";
        return localStorage.getItem("display-name") || "あなた";
    });

    const [users] = useState<User[]>(() => [
        { id: LOCAL_USER_ID, displayName },
        ...BOT_USERS,
    ]);

    const [room] = useState<Room>(() => ({
        ...sourceRoom,
        maxPlayers: 3,
    }));

    const items = room.items ?? [];

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const [currentTurn, setCurrentTurn] = useState(0);
    const [bombStatus, setBombStatus] = useState(0);
    const [isStarted, setIsStarted] = useState(true);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [lostDisplayName, setLostDisplayName] = useState<string | null>(null);

    const currentTurnRef = useRef(currentTurn);
    const usersRef = useRef(users);
    const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const successAudioRef = useRef<HTMLAudioElement | null>(null);

    const [userPositions] = useState<Position[]>(() =>
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
    );

    useEffect(() => {
        currentTurnRef.current = currentTurn;
    }, [currentTurn]);

    useEffect(() => {
        usersRef.current = users;
    }, [users]);

    const startGame = useCallback(() => {
        if (countdownTimerRef.current) {
            clearTimeout(countdownTimerRef.current);
        }

        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        setCurrentTurn(Math.floor(Math.random() * users.length));
        setCurrentItem(null);
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);

        countdownTimerRef.current = setTimeout(() => {
            setCurrentItem(randomItem(items));
            countdownTimerRef.current = null;
        }, 3000);
    }, [items, resetExplosion, users.length]);

    useEffect(() => {
        successAudioRef.current = new Audio("/Blip_select_8.wav");

        posthog.capture("playground_game_started", {
            room_id: room.id,
            player_count: users.length,
        });

        queueMicrotask(startGame);

        return () => {
            if (countdownTimerRef.current) {
                clearTimeout(countdownTimerRef.current);
            }
            successAudioRef.current?.pause();
        };
    }, [room.id, startGame, users.length]);

    const handleSuccess = useCallback(() => {
        if (successAudioRef.current && initialSounDeffects) {
            successAudioRef.current.currentTime = 0;
            successAudioRef.current.volume = 1;
            successAudioRef.current.play().catch(() => {});
        }

        setCurrentInput("");
        setCurrentTurn((previous) => (previous + 1) % users.length);
        setCurrentItem(randomItem(items));

        posthog.capture("word_succeeded", {
            mode: "playground",
            room_id: room.id,
        });
    }, [initialSounDeffects, items, room.id, users.length]);

    useEffect(() => {
        if (!isStarted || result !== null) return;

        const baseDuration =
            typeof room.gameDuration === "number" &&
            Number.isInteger(room.gameDuration) &&
            room.gameDuration >= 1
                ? room.gameDuration
                : 20;
        const duration = (baseDuration + Math.random() * 10) * 1000;

        const timer = setTimeout(() => {
            if (bombStatus === 4) {
                const lostUser = usersRef.current[currentTurnRef.current];
                const didLose = lostUser?.id === LOCAL_USER_ID;

                explode();
                setResult(didLose);
                setLostDisplayName(lostUser?.displayName ?? "練習相手");
                setBombStatus(0);

                posthog.capture(didLose ? "game_lost" : "game_won", {
                    mode: "playground",
                    room_id: room.id,
                });
                return;
            }

            setBombStatus((previous) => previous + 1);
        }, duration);

        return () => clearTimeout(timer);
    }, [
        bombStatus,
        explode,
        isStarted,
        result,
        room.gameDuration,
        room.id,
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
            BOT_TYPING[currentTurnUser.id as keyof typeof BOT_TYPING];
        if (!config) return;

        const target = currentItem.answer;
        let charIndex = 0;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const typeNextCharacter = () => {
            if (cancelled) return;

            if (charIndex < target.length) {
                charIndex += 1;
                setCurrentInput(target.slice(0, charIndex));
                timer = setTimeout(typeNextCharacter, config.charDelay);
                return;
            }

            timer = setTimeout(() => {
                if (!cancelled) handleSuccess();
            }, 200);
        };

        timer = setTimeout(typeNextCharacter, config.initialDelay);

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
            if (!initialBackgroundMusic || !audioRef.current) return;

            audioRef.current
                .play()
                .then(removeListeners)
                .catch(() => {});
        };

        const addListeners = () => {
            window.addEventListener("click", startAudio);
            window.addEventListener("touchstart", startAudio);
            window.addEventListener("keydown", startAudio);
        };

        const removeListeners = () => {
            window.removeEventListener("click", startAudio);
            window.removeEventListener("touchstart", startAudio);
            window.removeEventListener("keydown", startAudio);
        };

        startAudio();
        addListeners();

        return () => {
            removeListeners();
            audioRef.current?.pause();
        };
    }, [initialBackgroundMusic]);

    return (
        <GameView
            room={room}
            users={users}
            positions={userPositions}
            userId={LOCAL_USER_ID}
            currentTurn={currentTurn}
            bombStatus={bombStatus}
            currentItem={currentItem}
            currentInput={currentInput}
            isStarted={isStarted}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={setCurrentInput}
            onPlayAgain={startGame}
            onCreateRoom={() =>
                router.push(process.env.NEXT_PUBLIC_SIGN_IN_URL!)
            }
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
