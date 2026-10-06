"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import { Room, Word, User, Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const MOCK_WORDS: Word[] = [
    { jp: "見る", en: "see" },
    { jp: "見る", en: "look" },
    { jp: "りんご", en: "apple" },
    { jp: "猫", en: "cat" },
    { jp: "犬", en: "dog" },
    { jp: "太陽", en: "sun" },
    { jp: "月", en: "moon" },
    { jp: "星", en: "star" },
    { jp: "水", en: "water" },
    { jp: "火", en: "fire" },
    { jp: "本", en: "book" },
    { jp: "学校", en: "school" },
    { jp: "未来", en: "future" },
    { jp: "技術", en: "technology" },
    { jp: "科学", en: "science" },
    { jp: "世界", en: "world" },
    { jp: "自然", en: "nature" },
    { jp: "冒険", en: "adventure" },
    { jp: "挑戦", en: "challenge" },
    { jp: "創造", en: "create" },
    { jp: "発見", en: "discover" },
    { jp: "成長", en: "growth" },
    { jp: "コンピューター", en: "computer" },
    { jp: "プログラム", en: "program" },
    { jp: "インターネット", en: "internet" },
    { jp: "人工知能", en: "ai" },
    { jp: "ロボット", en: "robot" },
    { jp: "ゲーム", en: "game" },
    { jp: "音楽", en: "music" },
    { jp: "映画", en: "movie" },
    { jp: "写真", en: "photo" },
    { jp: "旅行", en: "travel" },
    { jp: "素晴らしい", en: "amazing" },
    { jp: "楽しい", en: "fun" },
    { jp: "速い", en: "fast" },
    { jp: "強い", en: "strong" },
    { jp: "美しい", en: "beautiful" },
];

const LOCAL_USER_ID = "player-1";

export default function Client({
    initialBackgroundMusic,
    initialSounDeffects,
}: Props) {
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();
    const [userId] = useState<string>(LOCAL_USER_ID);
    const [displayName] = useState<string>(() => {
        if (typeof window === "undefined") return "たま";
        return localStorage.getItem("display-name") || "たま";
    });

    const [users] = useState<User[]>(() => [
        { id: LOCAL_USER_ID, displayName: displayName },
        { id: "bot-1", displayName: "ボット1" },
        { id: "bot-2", displayName: "ボット2" },
    ]);

    const [room] = useState<Room>(() => ({
        id: "local-room",
        maxPlayers: 3,
        isStart: true,
        users: [
            { id: LOCAL_USER_ID, displayName: displayName },
            { id: "bot-1", displayName: "ボット1" },
            { id: "bot-2", displayName: "ボット2" },
        ],
        words: MOCK_WORDS,
        title: "デモルーム",
    }));

    const [currentWord, setCurrentWord] = useState<Word | null>(null);
    const [currentTurn, setCurrentTurn] = useState<number>(0);
    const [bombStatus, setBombStatus] = useState<number>(0);
    const [isStarted, setIsStarted] = useState<boolean>(true);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [lostDisplayName, setLostDisplayName] = useState<string | null>(null);

    const [userPositions] = useState<Position[]>(() =>
        newPositions(
            [
                { id: LOCAL_USER_ID, displayName: displayName },
                { id: "bot-1", displayName: "ボット1" },
                { id: "bot-2", displayName: "ボット2" },
            ],
            Array.from({ length: 3 }, () => ({
                x: 0,
                y: 0,
                w: 24,
                h: 24,
                opacity: 0,
            })),
        ),
    );

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blipAudioRef = useRef<HTMLAudioElement | null>(null);
    const powerupAudioRef = useRef<HTMLAudioElement | null>(null);
    const router = useRouter();

    const currentTurnUser = users[currentTurn] as User | undefined;
    const currentTurnRef = useRef(currentTurn);
    const usersRef = useRef(users);

    useEffect(() => {
        currentTurnRef.current = currentTurn;
    }, [currentTurn]);

    useEffect(() => {
        usersRef.current = users;
    }, [users]);

    const startGame = useCallback(() => {
        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        setCurrentTurn(Math.floor(Math.random() * users.length));
        setCurrentWord(null);
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);
        setTimeout(() => {
            setCurrentWord(
                MOCK_WORDS[Math.floor(Math.random() * MOCK_WORDS.length)],
            );
        }, 3000);
    }, [users.length, resetExplosion]);

    useEffect(() => {
        blipAudioRef.current = new Audio("/Blip_select_8.wav");
        powerupAudioRef.current = new Audio("/Powerup_1.wav");

        posthog.capture("game_started_offline", {
            player_count: 3,
        });

        queueMicrotask(() => {
            startGame();
        });
    }, [startGame]);

    const handleSuccess = useCallback(() => {
        if (powerupAudioRef.current && initialSounDeffects) {
            powerupAudioRef.current.currentTime = 0;
            powerupAudioRef.current.volume = 1;
            powerupAudioRef.current.play().catch(() => {});
        }

        setCurrentInput("");
        setCurrentTurn((prev) => (prev + 1) % users.length);
        setCurrentWord(
            MOCK_WORDS[Math.floor(Math.random() * MOCK_WORDS.length)],
        );

        posthog.capture("word_succeeded");
    }, [users.length, initialSounDeffects]);

    useEffect(() => {
        if (!isStarted || result !== null) return;

        const duration = Math.floor(Math.random() * 10000) + 20000;

        const timer = setTimeout(() => {
            const nextStatus = bombStatus + 1;
            if (nextStatus > 4) {
                explode();
                const lostUser = usersRef.current[currentTurnRef.current];
                const didLose = lostUser?.id === userId;
                setResult(didLose);
                setLostDisplayName(lostUser?.displayName || "不明なプレイヤー");
                posthog.capture(didLose ? "game_lost" : "game_won");
            }
            setBombStatus(nextStatus);
        }, duration);

        return () => clearTimeout(timer);
    }, [isStarted, result, bombStatus, userId, startGame, explode]);

    useEffect(() => {
        if (
            !isStarted ||
            result !== null ||
            !currentWord ||
            currentTurnUser?.id === userId
        )
            return;

        let timeoutId: NodeJS.Timeout;
        let isCancelled = false;

        const target = currentWord.en;
        let charIndex = 0;

        const typeNextChar = () => {
            if (isCancelled) return;

            if (charIndex < target.length) {
                charIndex++;
                setCurrentInput(target.slice(0, charIndex));

                const speed = Math.floor(Math.random() * 100) + 180;
                timeoutId = setTimeout(typeNextChar, speed);
            } else {
                timeoutId = setTimeout(() => {
                    if (!isCancelled) {
                        handleSuccess();
                    }
                }, 200);
            }
        };

        const initialDelay = Math.floor(Math.random() * 400) + 500;
        timeoutId = setTimeout(typeNextChar, initialDelay);

        return () => {
            isCancelled = true;
            clearTimeout(timeoutId);
        };
    }, [
        isStarted,
        currentTurn,
        currentWord,
        result,
        currentTurnUser,
        userId,
        handleSuccess,
    ]);

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (initialBackgroundMusic && audioRef.current) {
                audioRef.current
                    .play()
                    .then(() => {
                        removeListeners();
                    })
                    .catch(() => {});
            }
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
            if (audioRef.current) audioRef.current.pause();
        };
    }, [initialBackgroundMusic, router]);

    return (
        <GameView
            room={room}
            users={users}
            positions={userPositions}
            userId={userId}
            currentTurn={currentTurn}
            bombStatus={bombStatus}
            currentWord={currentWord}
            currentInput={currentInput}
            isStarted={isStarted}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={setCurrentInput}
            onPlayAgain={() => {
                setResult(null);
                startGame();
            }}
            onCreateRoom={() =>
                router.push(process.env.NEXT_PUBLIC_SIGN_IN_URL!)
            }
            resultExtraActions={
                <Button
                    iconName="link"
                    className="w-full"
                    onClick={() => router.push("/room")}
                >
                    招待リンクで参加
                </Button>
            }
        />
    );
}
