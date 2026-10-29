"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "@/lib/room/socket";
import { getAuthToken } from "@/lib/room/auth";
import ItemView from "@/components/feature/ItemView";
import Bomb from "@/components/feature/Bomb";

type Player = { id: string; name: string; hp: number; combo: number };
type Question = { id: string; type: "typed_recall"; prompt: string; answer: string };
type Battle = {
    players: Player[]; currentPlayerId: string | null; question: Question | null;
    turn: number; wordsCompleted: number; countersUsed: number; noHintStreak: number;
    incomingWords: string[]; status: "waiting" | "playing" | "finished";
    winnerId: string | null; revision: number;
};
type SocketLike = ReturnType<typeof io>;

export default function OnlineBattle() {
    const socketRef = useRef<SocketLike | null>(null);
    const [connected, setConnected] = useState(false);
    const [myId, setMyId] = useState("");
    const [battle, setBattle] = useState<Battle | null>(null);
    const [error, setError] = useState("");
    const [mode, setMode] = useState<"normal" | "counter">("normal");

    useEffect(() => {
        let disposed = false;
        const socket = io(process.env.NEXT_PUBLIC_RENDER_URL, { reconnection: true });
        socketRef.current = socket;
        socket.on("connect", () => { if (!disposed) { setConnected(true); setMyId(socket.id ?? ""); } });
        socket.on("disconnect", () => { if (!disposed) setConnected(false); });
        socket.on("auth:request", async () => {
            const jwtToken = await getAuthToken();
            if (!jwtToken || disposed) { setError("先にルームに参加してください。"); return; }
            socket.emit("auth:response", { jwtToken, displayName: localStorage.getItem("display-name") || "Player" });
            socket.emit("battle:join");
        });
        socket.on("room:broadcast", () => { if (!disposed) socket.emit("battle:join"); });
        socket.on("battle:state", (state: Battle) => { if (!disposed) { setBattle(state); setError(""); } });
        socket.on("battle:error", (message: string) => { if (!disposed) setError(message); });
        socket.on("error", (data: { message?: string }) => { if (!disposed) setError(data?.message ?? "接続エラー"); });
        return () => { disposed = true; socket.emit("battle:leave"); socket.disconnect(); socketRef.current = null; };
    }, []);

    const isMyTurn = battle?.status === "playing" && battle.currentPlayerId === myId;
    const counterReady = isMyTurn && (battle?.noHintStreak ?? 0) >= 1 &&
        (battle?.countersUsed ?? 0) < 3 && (battle?.incomingWords.length ?? 0) > 0;
    const question = battle?.question;
    const activeQuestion = mode === "counter" && counterReady
        ? { id: "counter", type: "typed_recall" as const, prompt: "カウンター", answer: battle!.incomingWords[0] }
        : question;

    function submit() {
        if (!battle || !activeQuestion || !isMyTurn) return;
        socketRef.current?.emit("battle:answer", {
            answer: activeQuestion.answer, mode: mode === "counter" && counterReady ? "counter" : "normal",
            turn: battle.turn, wordIndex: battle.wordsCompleted,
        });
        setMode("normal");
    }

    return (
        <main className="w-full max-w-3xl px-4 py-8 flex flex-col gap-5">
            <h1 className="text-3xl font-bold">Ei-TypeBattle — オンライン対戦</h1>
            <p className="text-sm opacity-70">{connected ? "サーバーに接続中" : "サーバーへ接続しています…"} ・ 既存のルーム認証を使用</p>
            {error && <p role="alert" className="text-red-500">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
                {(battle?.players ?? []).map(player => (
                    <div key={player.id} className="rounded-xl bg-(--color-background-secondary) p-4">
                        <p className="font-bold">{player.name} {player.id === myId ? "（あなた）" : ""}</p>
                        <p>HP {player.hp}/100 ・ {player.combo} COMBO</p>
                        <div className="h-2 bg-black/15 rounded mt-2 overflow-hidden">
                            <div className="h-full bg-cyan-600" style={{ width: `${player.hp}%` }} />
                        </div>
                    </div>
                ))}
            </div>
            <div className="rounded-xl bg-(--color-background-secondary) p-5 flex flex-col items-center gap-4">
                <Bomb bombStatus={0} shaking={false} />
                {!battle && <p>対戦ルームに参加しています…</p>}
                {battle?.status === "waiting" && <>
                    <p>{battle.players.length}/2 人参加中。2人そろうと開始できます。</p>
                    {battle.players.length === 2 && battle.players[0].id === myId &&
                        <button className="rounded-lg bg-cyan-600 text-white px-5 py-3" onClick={() => socketRef.current?.emit("battle:start")}>対戦開始</button>}
                </>}
                {battle?.status === "finished" && <p className="font-bold text-xl">{battle.winnerId === myId ? "勝利！" : "対戦終了"}</p>}
                {battle?.status === "playing" && <>
                    <p className="font-bold">{isMyTurn ? "あなたのターン" : "相手のターン"} ・ {battle.wordsCompleted + 1}/5</p>
                    {isMyTurn && activeQuestion ? <>
                        <div className="flex gap-3">
                            <button onClick={() => setMode("normal")} className="rounded-lg border px-4 py-2">通常攻撃</button>
                            <button disabled={!counterReady} onClick={() => setMode("counter")} className="rounded-lg border px-4 py-2 disabled:opacity-40">カウンター</button>
                        </div>
                        <ItemView
                            key={`${battle.revision}-${mode}`}
                            item={activeQuestion}
                            currentInput={null}
                            bombStatus={0}
                            enableRemoteTypingSync={false}
                            onSuccess={submit}
                            onChangeInput={() => {}}
                        />
                    </> : <p>相手の入力を待っています…</p>}
                </>}
            </div>
            <p className="text-xs opacity-60">オンライン対戦の初期版です。単語の正解はサーバーで判定しますが、問題データはクライアントにも送られるため、不正対策は未完成です。</p>
        </main>
    );
}
