"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from "react";
import ItemView from "@/components/recall/ItemView";
import { getTypingAnswer } from "@/lib/answer-mode";
import {
    chooseNextUserItem,
    createScheduler,
    recordUserAnswer,
    type SchedulerState,
} from "@/lib/playground/scheduler";
import { getBotTypingFrames } from "@/lib/playground/bot-typing.mjs";
import type { GameBomb, Item } from "@/type";
import { useBombExplosion } from "@/components/game/BombExplosion";
import UsersView from "@/components/game/UsersView";
import {
    clearWrongAnswerAnimation,
    playWrongAnswerAnimation,
} from "@/components/game/wrong-answer-animation";
import Button from "@/components/ui/Button";
import {
    battleReducer,
    initialBattle,
    WORDS_PER_ENEMY,
    type EnemyWord,
} from "./battle";

const BEST_KEY = "ei-typebattle:solo-best";
const POSITIONS = [
    { x: -25, y: 0, w: 56, h: 56, opacity: 1 },
    { x: 25, y: 0, w: 56, h: 56, opacity: 1 },
];
const PHASE_NOTICE = {
    ready: "",
    preparing: "敵が単語を入力中…",
    armed: "敵が爆弾を用意した！",
    incoming: "敵が爆弾を送ってきた！",
    typing: "問題の答えを入力",
    returning: "爆弾を返した！",
    defeated: "敵を倒した！",
    over: "時間切れ",
};

function readBest(key: string) {
    try {
        const value = Number(localStorage.getItem(key));
        return Number.isSafeInteger(value) && value > 0 ? value : 0;
    } catch {
        return 0;
    }
}

function subscribeBest(callback: () => void) {
    window.addEventListener("storage", callback);
    window.addEventListener(BEST_KEY, callback);
    return () => {
        window.removeEventListener("storage", callback);
        window.removeEventListener(BEST_KEY, callback);
    };
}

function recordCorrectAnswer(scheduler: SchedulerState) {
    recordUserAnswer(scheduler, {
        memoryEvidence: "recall",
        retryNeed: "none",
        reason: null,
        independent: false,
    });
}

export default function SoloBattle({ items, roomId }: { items: Item[]; roomId?: string }) {
    const [battle, dispatch] = useReducer(battleReducer, initialBattle);
    const bestKey = roomId ? `${BEST_KEY}:${roomId}` : BEST_KEY;
    const getBest = useCallback(() => readBest(bestKey), [bestKey]);
    const best = useSyncExternalStore(subscribeBest, getBest, () => 0);
    const questionRef = useRef<HTMLDivElement>(null);
    const run = useRef<{ scheduler: SchedulerState; question: number } | null>(null);
    const { bombRef, explode, resetExplosion, explosionLayer } = useBombExplosion();
    const { phase, deadline, defeated, remaining, timeLimit, correct, question } = battle;
    const typingItems = useMemo(() => items.filter((item) => getTypingAnswer(item) !== null), [items]);
    const currentItem = typingItems.find(
        (item) => item.id === battle.enemyWords[correct]?.itemId,
    );

    function buildEnemyWords(scheduler: SchedulerState): EnemyWord[] {
        return Array.from({ length: WORDS_PER_ENEMY }, () => {
            const selection = chooseNextUserItem(scheduler);
            const item = typingItems.find((entry) => entry.id === selection?.itemId);
            const answer = item ? getTypingAnswer(item) : null;
            if (!item || !answer) throw new Error("Missing enemy typing item");
            recordCorrectAnswer(scheduler);
            return { itemId: item.id, frames: getBotTypingFrames(answer) };
        });
    }

    function start() {
        if (!typingItems.length) return;
        const scheduler = createScheduler(typingItems.map((item) => item.id));
        run.current = { scheduler, question: 0 };
        dispatch({ type: "start", now: performance.now(), enemyWords: buildEnemyWords(scheduler) });
    }

    function answer() {
        const now = performance.now();
        const currentRun = run.current;
        if (phase !== "typing" || now >= deadline || currentRun?.question !== question) return;
        currentRun.question += 1;
        dispatch({
            type: "answer",
            now,
            question,
            nextEnemyWords: correct + 1 === WORDS_PER_ENEMY ? buildEnemyWords(currentRun.scheduler) : [],
        });
    }

    useEffect(() => {
        if (phase === "ready" || phase === "over") return;
        const tick = () => {
            const now = performance.now();
            dispatch({
                type: "tick",
                now,
                random: phase === "incoming" && now >= deadline ? Math.random() : 0.5,
            });
        };
        const timeout = window.setTimeout(tick, Math.max(0, deadline - performance.now()));
        const interval = window.setInterval(tick, 100);
        return () => {
            window.clearTimeout(timeout);
            window.clearInterval(interval);
        };
    }, [phase, deadline]);

    useEffect(() => {
        if (phase === "preparing") resetExplosion();
        if (phase === "defeated" || phase === "over") explode();
    }, [phase, explode, resetExplosion]);

    useEffect(() => {
        if (defeated <= getBest()) return;
        try {
            localStorage.setItem(bestKey, String(defeated));
            window.dispatchEvent(new Event(BEST_KEY));
        } catch {
            // The current run is playable when browser storage is unavailable.
        }
    }, [bestKey, defeated, getBest]);

    const enemyNumber = phase === "defeated" ? defeated : defeated + 1;
    const fraction = phase === "typing" ? remaining / timeLimit : 1;
    const bombStatus = phase === "typing" ? Math.min(4, Math.floor((1 - fraction) * 5)) : 4;
    const activeBomb = phase === "returning" || phase === "defeated" ? correct - 1 : correct;
    const isAtPlayer = phase === "incoming" || phase === "typing" || phase === "over";
    const bombs: GameBomb[] = phase === "ready" || phase === "preparing"
        ? []
        : Array.from({ length: WORDS_PER_ENEMY }, (_, index) => ({
              id: `${enemyNumber}:${index}`,
              holder: index === activeBomb && isAtPlayer ? 0 : 1,
              status: index === activeBomb && phase !== "armed" && phase !== "incoming"
                  ? bombStatus
                  : index < correct ? 3 : 0,
              turn: index,
              at: deadline,
          })).sort((left, right) => Number(right.turn === activeBomb) - Number(left.turn === activeBomb));
    const enemySpelling = phase === "preparing"
        ? battle.enemyWords[battle.enemyWord]?.frames[battle.enemyFrame - 1] ?? ""
        : "";

    return (
        <section className="flex w-full flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-(--color-background-secondary) p-3">
                    <dt className="text-sm">倒した敵</dt>
                    <dd className="font-mono text-xl font-bold">{defeated} 人</dd>
                </div>
                <div className="rounded-lg bg-(--color-background-secondary) p-3">
                    <dt className="text-sm">自己ベスト</dt>
                    <dd className="font-mono text-xl font-bold">{Math.max(best, defeated)} 人</dd>
                </div>
            </dl>

            <div className="overflow-hidden rounded-lg bg-(--color-background-secondary)">
                <div className="h-36 sm:h-44">
                    <UsersView
                        users={[{ id: "player", displayName: "あなた" }, { id: "enemy", displayName: `敵 ${enemyNumber}` }]}
                        positions={POSITIONS}
                        userId="player"
                        currentTurn={null}
                        bombStatus={bombStatus}
                        bombs={bombs}
                        bombRef={bombRef}
                        exploded={phase === "defeated" || phase === "over"}
                        loserIds={phase === "defeated" ? ["enemy"] : phase === "over" ? ["player"] : []}
                    />
                </div>
                {phase === "preparing" && (
                    <div className="min-h-12 px-4 pb-4 text-center">
                        <span className="break-all font-mono text-xl font-bold">
                            {enemySpelling}
                        </span>
                        <span className="ml-3 whitespace-nowrap font-mono text-sm">
                            {battle.enemyWord + 1} / {WORDS_PER_ENEMY}
                        </span>
                    </div>
                )}
                {phase === "typing" && (
                    <p className="pb-4 text-center font-mono text-sm font-bold">
                        {correct} / {WORDS_PER_ENEMY} 問
                    </p>
                )}
            </div>

            <p className="min-h-6 text-center font-bold" role="status">
                {phase === "ready" ? `敵が作った爆弾を、1問正解するたびに1個返そう。全部返すと次の敵に進みます。` : PHASE_NOTICE[phase]}
            </p>

            {phase === "ready" || phase === "over" ? (
                <Button
                    variant="primary"
                    onClick={start}
                    disabled={typingItems.length === 0}
                >
                    {phase === "ready" ? "対戦を始める" : "もう一度プレイ"}
                </Button>
            ) : phase === "typing" && currentItem ? (
                <div
                    key={question}
                    ref={questionRef}
                    onAnimationEnd={clearWrongAnswerAnimation}
                >
                    <ItemView
                        item={currentItem}
                        items={typingItems}
                        answerMode="input"
                        currentInput={null}
                        bombStatus={bombStatus}
                        hasDuplicatePrompt={
                            items.filter((item) => item.prompt === currentItem.prompt).length > 1
                        }
                        enableRemoteTypingSync={false}
                        onChangeInput={(_, failed) => {
                            if (failed) playWrongAnswerAnimation(questionRef.current);
                        }}
                        onSuccess={answer}
                    />
                </div>
            ) : null}
            {typingItems.length === 0 && (
                <p role="status">このルームには入力形式で出題できる単語がありません。</p>
            )}
            {explosionLayer}
        </section>
    );
}
