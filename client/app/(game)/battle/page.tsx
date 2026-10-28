"use client";

import { useEffect, useRef, useState } from "react";
import Bomb from "@/components/feature/Bomb";
import Button from "@/components/ui/Button";

import { getBattleWords } from "@/lib/room/battleWords";

type Word = { prompt: string; answer: string };
type Player = { hp: number; combo: number };
type Hit = { target: number; damage: number; word: string };
const initialPlayers = (): [Player, Player] => [{ hp: 100, combo: 0 }, { hp: 100, combo: 0 }];

/** Local two-player prototype; no socket events or multiplayer synchronization yet. */
export default function BattlePreview() {
    const [words, setWords] = useState<Word[]>([]);
    const [roomTitle, setRoomTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    useEffect(() => {
        let active = true;
        getBattleWords().then((result) => {
            if (!active) return;
            if (!result || result.words.length === 0) setLoadError(true);
            else { setWords(result.words); setRoomTitle(result.title); }
        }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    const [players, setPlayers] = useState<[Player, Player]>(initialPlayers);
    const [turn, setTurn] = useState(0);
    const [slot, setSlot] = useState(0);
    const [wordNumber, setWordNumber] = useState(0);
    const [answer, setAnswer] = useState("");
    const [mode, setMode] = useState<"normal" | "counter">("normal");
    const [noHintStreak, setNoHintStreak] = useState(0);
    const [countersUsed, setCountersUsed] = useState(0);
    const [incoming, setIncoming] = useState<string[]>([]);
    const [outgoing, setOutgoing] = useState<string[]>([]);
    const [hintUsed, setHintUsed] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [message, setMessage] = useState("5単語正解するとターン交代");
    const [hit, setHit] = useState<Hit | null>(null);
    const [winner, setWinner] = useState<number | null>(null);
    const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const word = words[wordNumber % words.length];
    const counterReady = noHintStreak >= 1 && countersUsed < 3 && incoming.length > 0;
    const counterWord = incoming[0];
    const target = mode === "counter" ? counterWord : word.answer;
    const prompt = mode === "counter" ? "相手の攻撃を打ち返そう" : word.prompt;

    useEffect(() => () => { if (hitTimer.current) clearTimeout(hitTimer.current); }, []);

    function reset() {
        setPlayers(initialPlayers()); setTurn(0); setSlot(0); setWordNumber(0);
        setAnswer(""); setMode("normal"); setNoHintStreak(0); setCountersUsed(0);
        setIncoming([]); setOutgoing([]); setHintUsed(false); setShowHint(false);
        setMessage("5単語正解するとターン交代"); setHit(null); setWinner(null);
        if (hitTimer.current) clearTimeout(hitTimer.current);
    }

    function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (winner !== null) return;
        if (mode === "counter" && (!counterReady || hintUsed)) {
            setMessage("カウンターには連続ヒントなし正解が必要です");
            return;
        }
        if (answer !== target) {
            setPlayers((prev) => prev.map((p, i) => i === turn ? { ...p, combo: 0 } : p) as [Player, Player]);
            setNoHintStreak(0);
            setMessage("不正解：コンボが途切れました");
            setAnswer("");
            return;
        }
        const other = 1 - turn;
        const combo = players[turn].combo + 1;
        const baseDamage = Math.min(35, 20 + (combo - 1) * 5);
        const damage = mode === "counter" ? Math.floor(baseDamage / 2) : baseDamage;
        const healed = mode === "counter" ? Math.min(10, 100 - players[turn].hp) : 0;
        const hp = Math.max(0, players[other].hp - damage);
        setPlayers((prev) => prev.map((p, i) =>
            i === turn ? { ...p, combo, hp: p.hp + healed } :
            { ...p, hp },
        ) as [Player, Player]);
        setHit({ target: other, damage, word: target });
        if (hitTimer.current) clearTimeout(hitTimer.current);
        hitTimer.current = setTimeout(() => setHit(null), 850);
        setMessage(mode === "counter" ? `カウンター！ -${damage} / HP+${healed}` : `${combo} COMBO！ -${damage} HP`);
        const sent = [...outgoing, target];
        const nextIncoming = mode === "counter" ? incoming.slice(1) : incoming;
        setAnswer(""); setHintUsed(false); setShowHint(false); setMode("normal");
        if (mode !== "counter") setWordNumber((n) => n + 1);
        if (hp === 0) { setWinner(turn); return; }
        if (slot === 4) {
            setTurn(other); setSlot(0); setNoHintStreak(0); setCountersUsed(0);
            setIncoming(sent); setOutgoing([]);
        } else {
            setSlot((n) => n + 1);
            setNoHintStreak(hintUsed ? 0 : noHintStreak + 1);
            setCountersUsed((n) => n + (mode === "counter" ? 1 : 0));
            setIncoming(nextIncoming); setOutgoing(sent);
        }
    }

    if (loading) return <main className="p-8">単語リストを読み込み中…</main>;
    if (loadError || words.length === 0) return <main className="p-8">単語リストを読み込めませんでした。先にルームを選択してください。</main>;
    return (
        <main className="w-full max-w-3xl px-4 py-8 flex flex-col gap-5">
            <div className="flex justify-between items-center gap-3">
                <div><h1 className="text-3xl font-bold">Ei-TypeBattle</h1><p className="opacity-60 text-sm">ローカル2人対戦プレビュー ・ {roomTitle}（{words.length}単語）</p></div>
                <div className="w-32"><Button onClick={reset}>最初から</Button></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {players.map((player, i) => (
                    <div key={i} className={`rounded-2xl p-4 bg-(--color-background-secondary) transition-all duration-(--duration-etb) ${turn === i ? "ring-2 ring-cyan-600" : ""}`}>
                        <div className="flex justify-between font-bold"><span>プレイヤー{i + 1}</span><span>{player.hp}/100</span></div>
                        <div className="h-2 rounded-full bg-black/15 dark:bg-white/15 mt-3 overflow-hidden"><div className="h-full bg-cyan-600 transition-all duration-(--duration-etb)" style={{ width: `${player.hp}%` }} /></div>
                        <p className="mt-2 text-sm opacity-70">{player.combo} COMBO</p>
                    </div>
                ))}
            </div>
            <div className="relative min-h-32 rounded-2xl bg-(--color-background-secondary) flex items-center justify-between px-10 overflow-hidden">
                <div className="flex flex-col items-center gap-2"><Bomb bombStatus={0} shaking={false}/><span className="text-xs">P1</span></div>
                <div className="font-bold text-sm text-center">{hit ? `-${hit.damage} HP` : "VS"}</div>
                <div className="flex flex-col items-center gap-2"><Bomb bombStatus={0} shaking={false}/><span className="text-xs">P2</span></div>
                {hit && <div key={`${turn}-${slot}-${hit.word}`} className={`battle-bomb-projectile ${hit.target === 0 ? "battle-bomb-to-left" : "battle-bomb-to-right"}`} aria-hidden="true"><Bomb bombStatus={3} shaking={false}/></div>}
            </div>
            <div className="rounded-2xl bg-(--color-background-secondary) p-5 flex flex-col items-center gap-4">
                {winner !== null ? <h2 className="text-2xl font-bold">プレイヤー{winner + 1}の勝利！</h2> : <>
                    <p className="font-bold">プレイヤー{turn + 1}のターン ・ {slot + 1}/5単語</p>
                    <p className="text-xl font-bold">{prompt}</p>
                    <div className="flex gap-3 w-full max-w-sm">
                        <button className={`rounded-lg px-4 py-2 font-bold flex-1 ${mode === "normal" ? "bg-cyan-600 text-white" : "bg-(--color-background)"}`} onClick={() => { setMode("normal"); setAnswer(""); setHintUsed(false); setShowHint(false); }}>通常攻撃</button>
                        <button disabled={!counterReady} className={`rounded-lg px-4 py-2 font-bold flex-1 disabled:opacity-40 ${mode === "counter" ? "bg-cyan-600 text-white" : "bg-(--color-background)"}`} onClick={() => { setMode("counter"); setAnswer(""); setHintUsed(false); setShowHint(false); }}>カウンター {countersUsed}/3</button>
                    </div>
                    <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
                        <input autoComplete="off" autoCapitalize="off" spellCheck={false} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="英単語を入力" className="rounded-lg bg-(--color-background) border border-(--color-border) px-4 py-3 w-full text-center font-mono" aria-label="英単語を入力"/>
                        <Button type="submit" variant="primary">攻撃する</Button>
                    </form>
                    {mode === "normal" && <button className="text-sm underline opacity-70" onClick={() => { setShowHint(true); setHintUsed(true); }}>ヒントを見る</button>}
                    {showHint && <p className="font-mono text-sm">{word.answer}</p>}
                    <p className="text-sm text-center" role="status">{message}</p>
                </>}
            </div>
            <p className="text-xs opacity-60">このページはブラウザ内で交代操作する試作品です。オンライン対戦ではありません。既存のBombコンポーネントとテーマを再利用しています。</p>
        </main>
    );
}
