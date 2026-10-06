import { useEffect, useRef, useState } from "react";
import { io } from "@/lib/room/socket";
import { getAuthToken } from "@/lib/room/auth";
import type {
    RecallObservation,
    RecallProgress,
} from "@/lib/playground/memory";

const DEFAULT_HINT_INTERVALS_MS = [5_000];

const correctPrefixLength = (input: string[], answer: string) => {
    let length = 0;

    while (
        length < input.length &&
        length < answer.length &&
        input[length] !== "" &&
        input[length] === answer[length]
    ) {
        length += 1;
    }

    return length;
};

const isSoundEffectsEnabled = () => {
    if (typeof document === "undefined") return true;

    return document.cookie
        .split(";")
        .some(
            (cookie) =>
                cookie.trim() === "sound-effects=true" ||
                cookie.trim() === "sound-effects",
        );
};

export default function TypingView({
    japanese,
    english,
    onSuccess,
    onChangeInput,
    currentInput,
    bombStatus,
    hasDuplicateMeaning = false,
    enableRemoteTypingSync = true,
    hintIntervalsMs = DEFAULT_HINT_INTERVALS_MS,
    onRecallProgress,
    onRecallComplete,
}: {
    japanese: string;
    english: string | null;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
    currentInput: string | null;
    bombStatus?: number | null;
    hasDuplicateMeaning?: boolean;
    enableRemoteTypingSync?: boolean;
    hintIntervalsMs?: number[];
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
}) {
    const baseHintCount = hasDuplicateMeaning ? 1 : 0;
    const [timedHintCount, setTimedHintCount] = useState(0);
    const [revealedHintLength, setRevealedHintLength] =
        useState(baseHintCount);
    const [input, setInput] = useState<string[]>(
        english ? Array(english.length).fill("") : [],
    );
    const [currentSelection, setCurrentSelection] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputFrameRef = useRef<HTMLDivElement | null>(null);
    const [charInput, setCharInput] = useState("");
    const [isFailAnimating, setIsFailAnimating] = useState(false);
    const [syncedInput, setSyncedInput] = useState("");
    const wordKey = JSON.stringify([japanese, english]);
    const [previousWordKey, setPreviousWordKey] = useState(wordKey);
    const recallStartedAtRef = useRef(performance.now());
    const firstKeyAtRef = useRef<number | null>(null);
    const attemptCountRef = useRef(1);
    const maxCorrectPrefixRef = useRef(0);
    const hintIntervalsKey = hintIntervalsMs.join(",");

    if (previousWordKey !== wordKey) {
        setPreviousWordKey(wordKey);
        setTimedHintCount(0);
        setRevealedHintLength(baseHintCount);
        setInput(english ? Array(english.length).fill("") : []);
        setCurrentSelection(0);
        setCharInput("");
        setSyncedInput("");
        setIsFailAnimating(false);
        recallStartedAtRef.current = performance.now();
        firstKeyAtRef.current = null;
        attemptCountRef.current = 1;
        maxCorrectPrefixRef.current = 0;
    }

    const isReadonly = currentInput !== null;

    useEffect(() => {
        if (isReadonly || !english) return;

        recallStartedAtRef.current = performance.now();
        firstKeyAtRef.current = null;
        attemptCountRef.current = 1;
        maxCorrectPrefixRef.current = 0;
    }, [english, isReadonly, wordKey]);

    useEffect(() => {
        if (isReadonly || !english) {
            setTimedHintCount(0);
            setRevealedHintLength(baseHintCount);
            return;
        }

        setTimedHintCount(0);
        setRevealedHintLength(baseHintCount);

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let hintIndex = 0;

        const scheduleNextHint = () => {
            if (cancelled || hintIndex >= english.length) return;

            const delay =
                hintIntervalsMs[
                    Math.min(
                        hintIndex,
                        Math.max(0, hintIntervalsMs.length - 1),
                    )
                ] ?? 2_500;

            timer = setTimeout(() => {
                setTimedHintCount((count) =>
                    Math.min(count + 1, english.length),
                );
                hintIndex += 1;
                scheduleNextHint();
            }, delay);
        };

        scheduleNextHint();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [
        english,
        hintIntervalsKey,
        hintIntervalsMs,
        isReadonly,
        wordKey,
    ]);

    useEffect(() => {
        if (!isReadonly) {
            inputRef.current?.focus();
            return;
        }

        if (!enableRemoteTypingSync) return;

        let socket: ReturnType<typeof io> | null = null;
        let cancelled = false;

        const connect = async () => {
            const authToken = await getAuthToken();
            if (!authToken || cancelled) return;

            socket = io(
                typeof window === "undefined"
                    ? undefined
                    : process.env.NEXT_PUBLIC_RENDER_URL,
            );

            socket.on("auth:request", () => {
                socket?.emit("auth:response", {
                    jwtToken: authToken,
                    displayName: "",
                });
            });

            socket.on("typing:input", ({ input }: { input: string }) => {
                setSyncedInput(input);
            });
        };

        connect();

        return () => {
            cancelled = true;
            socket?.disconnect();
            socket = null;
        };
    }, [enableRemoteTypingSync, isReadonly]);

    const triggerFailAnimation = () => {
        // Restart an in-flight shake without an older timer stopping it early.
        inputFrameRef.current?.getAnimations().forEach((animation) => {
            animation.currentTime = 0;
        });
        setIsFailAnimating(true);
    };

    const resetInput = () => {
        if (!english) return;
        if (input.some((character) => character !== "")) {
            attemptCountRef.current += 1;
        }
        setInput(Array(english.length).fill(""));
        setCurrentSelection(0);
        setCharInput("");
        triggerFailAnimation();
        onChangeInput("");
    };

    const hintCount = baseHintCount + timedHintCount;
    const calculatedHintLength = english
        ? Math.min(
              english.length,
              correctPrefixLength(input, english) + hintCount,
          )
        : 0;
    const hintLength = Math.max(
        revealedHintLength,
        calculatedHintLength,
    );

    useEffect(() => {
        if (isReadonly || !english || hintLength === 0) return;

        if (hintLength > revealedHintLength) {
            setRevealedHintLength(hintLength);
        }

        const hasWrongHintedCharacter = input
            .slice(0, hintLength)
            .some(
                (character, index) =>
                    character !== "" && character !== english[index],
            );

        if (hasWrongHintedCharacter) {
            if (input.some((character) => character !== "")) {
                attemptCountRef.current += 1;
            }
            setInput(Array(english.length).fill(""));
            setCurrentSelection(0);
            setCharInput("");
            inputFrameRef.current?.getAnimations().forEach((animation) => {
                animation.currentTime = 0;
            });
            setIsFailAnimating(true);
            onChangeInput("");
        }
    }, [
        english,
        hintLength,
        input,
        isReadonly,
        onChangeInput,
        revealedHintLength,
    ]);

    useEffect(() => {
        if (isReadonly || !english) return;

        onRecallProgress?.({
            attemptCount: attemptCountRef.current,
            hintCount,
            revealedHintChars: hintLength,
            maxCorrectPrefixLength: maxCorrectPrefixRef.current,
            recallLatencyMs:
                firstKeyAtRef.current === null
                    ? null
                    : Math.max(
                          0,
                          firstKeyAtRef.current -
                              recallStartedAtRef.current,
                      ),
            elapsedMs: Math.max(
                0,
                performance.now() - recallStartedAtRef.current,
            ),
        });
    }, [
        english,
        hintCount,
        hintLength,
        input,
        isReadonly,
        onRecallProgress,
    ]);

    if (!english) return null;

    const moveToNext = (next: string[]) => {
        const nextIndex = currentSelection + 1;
        maxCorrectPrefixRef.current = Math.max(
            maxCorrectPrefixRef.current,
            correctPrefixLength(next, english),
        );
        const nextHintLength = Math.min(
            english.length,
            correctPrefixLength(next, english) + hintCount,
        );
        const typedInsideHint =
            currentSelection < nextHintLength &&
            next[currentSelection] !== english[currentSelection];

        if (typedInsideHint) {
            resetInput();
            return;
        }

        if (nextIndex < english.length) {
            setCurrentSelection(nextIndex);
            onChangeInput(next.join(""));
        } else {
            const result = next.join("");
            if (result === english) {
                const observation: RecallObservation = {
                    success: true,
                    answerLength: english.length,
                    firstAttemptCorrect:
                        attemptCountRef.current === 1 &&
                        hintCount === 0,
                    attemptCount: attemptCountRef.current,
                    hintCount,
                    revealedHintChars: hintLength,
                    maxCorrectPrefixLength:
                        maxCorrectPrefixRef.current,
                    recallLatencyMs:
                        firstKeyAtRef.current === null
                            ? null
                            : Math.max(
                                  0,
                                  firstKeyAtRef.current -
                                      recallStartedAtRef.current,
                              ),
                    elapsedMs: Math.max(
                        0,
                        performance.now() -
                            recallStartedAtRef.current,
                    ),
                };
                onRecallComplete?.(observation);
                onSuccess();
                const next = Array(english.length).fill("");
                setInput(next);
                setCurrentSelection(0);
                console.log("bombStatus", bombStatus);
                setTimedHintCount(0);
                setRevealedHintLength(baseHintCount);
                onChangeInput(next.join(""));

                if (isSoundEffectsEnabled()) {
                    const audio = new Audio("/Blip_select_36.wav");
                    audio.volume = 1;
                    audio.play().catch(() => {
                        console.log(
                            "Audio playback prevented by browser policy.",
                        );
                    });
                }
            } else {
                console.log("Wrong answer. Query:", result);
                resetInput();
            }
        }
    };

    const displayInput = isReadonly
        ? enableRemoteTypingSync && currentInput === ""
            ? syncedInput
            : currentInput
        : input.join("");
    const displayChars = isReadonly ? [...displayInput] : input;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center">
                <div
                    className="font-bold text-xl text-center w-fit border border-(--color-border) px-2 rounded-lg py-1"
                    data-cursor="text"
                >
                    {japanese}
                </div>
            </div>
            <div className="w-full flex justify-center">
                <div
                    ref={inputFrameRef}
                    className={`w-fit relative rounded-lg border border-(--color-border) p-1 overflow-clip gap-y-3 flex-wrap flex justify-start ${isFailAnimating ? "wrong-answer" : ""}`}
                    onAnimationEnd={(event) => {
                        if (event.target === event.currentTarget)
                            setIsFailAnimating(false);
                    }}
                    onClick={() => {
                        if (!isReadonly) inputRef.current?.focus();
                    }}
                >
                    {[...english].map((char, index) => {
                        const isSelected =
                            !isReadonly && index === currentSelection;
                        if (char === " ")
                            return (
                                <button
                                    key={index}
                                    className={`relative cursor-text z-20 font-bold w-4 h-16 active:scale-95 rounded-sm text-2xl transition-all p-1 duration-150 ease-etb ${isSelected ? "bg-(--color-border)" : ""}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (currentInput === null)
                                            setCurrentSelection(index);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    <div className="flex items-center justify-center h-full w-full" />
                                </button>
                            );
                        return (
                            <button
                                key={index}
                                className={`relative cursor-text z-20 font-bold font-mono w-8 h-16 rounded-sm text-3xl transition-all p-1 duration-150 ease-etb ${isSelected ? "bg-(--color-border)" : ""} ${currentInput == null ? "active:scale-95" : ""}`}
                                data-cursor="button"
                                data-cursor-shape={
                                    currentInput === null ? "1" : "2"
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (currentInput === null)
                                        setCurrentSelection(index);
                                    inputRef.current?.focus();
                                }}
                            >
                                {index < hintLength && (
                                    <div className="absolute inset-1 pointer-events-none opacity-25 border-b border-(--color-border) flex items-center justify-center">
                                        {char}
                                    </div>
                                )}
                                <div className="relative border-b border-(--color-border) flex items-center justify-center h-full w-full">
                                    {displayChars?.[index] ?? ""}
                                </div>
                            </button>
                        );
                    })}
                    {!isReadonly && (
                        <input
                            ref={inputRef}
                            value={charInput}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (!value) return;
                                const char = value.slice(-1);
                                if (firstKeyAtRef.current === null) {
                                    firstKeyAtRef.current =
                                        performance.now();
                                }
                                const targetChar = english[currentSelection];
                                if (targetChar === " ") {
                                    if (char === " ") {
                                        const next = [...input];
                                        next[currentSelection] = " ";
                                        setInput(next);
                                        moveToNext(next);
                                    }
                                    setCharInput("");
                                    return;
                                }
                                if (char !== " ") {
                                    const next = [...input];
                                    next[currentSelection] = char;
                                    setInput(next);
                                    moveToNext(next);
                                }
                                setCharInput("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    setCurrentSelection(
                                        Math.max(0, currentSelection - 1),
                                    );
                                }
                                if (e.key === "ArrowRight") {
                                    e.preventDefault();
                                    setCurrentSelection(
                                        Math.min(
                                            english.length - 1,
                                            currentSelection + 1,
                                        ),
                                    );
                                }
                                if (e.key === "Backspace") {
                                    e.preventDefault();
                                    const next = [...input];
                                    if (next[currentSelection]) {
                                        next[currentSelection] = "";
                                        setInput(next);
                                        onChangeInput(next.join(""));
                                        return;
                                    }
                                    const prev = currentSelection - 1;
                                    if (prev >= 0) {
                                        next[prev] = "";
                                        setInput(next);
                                        setCurrentSelection(prev);
                                    }
                                    onChangeInput(next.join(""));
                                }
                            }}
                            onFocus={() => {
                                setTimeout(() => {
                                    inputRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "center",
                                    });
                                }, 300);
                            }}
                            className="absolute inset-0 w-full h-full opacity-[0.01] z-10"
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="text"
                            enterKeyHint="next"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
