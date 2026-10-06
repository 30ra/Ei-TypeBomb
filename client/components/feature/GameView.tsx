"use client";

import type { ReactNode, Ref } from "react";
import TypingView from "@/components/feature/InputView";
import UsersView from "@/components/feature/UsersView";
import Button from "@/components/ui/Button";
import type { Position, Room, User, Word } from "@/type";

type Props = {
    room: Room | null;
    users: User[];
    positions: Position[];
    userId: string | null;
    currentTurn: number;
    bombStatus: number;
    currentWord: Word | null;
    currentInput: string;
    isStarted: boolean;
    isSpectator?: boolean;
    serverError?: string | null;
    connectionAlert?: boolean;
    result: boolean | null;
    lostDisplayName?: string | null;
    bombRef?: Ref<HTMLDivElement>;
    explosionLayer?: ReactNode;
    resultExtraActions?: ReactNode;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
    onPlayAgain: () => void;
    onCreateRoom: () => void;
    onJoin?: () => void;
    onWatch?: () => void;
    onStartGame?: () => void;
    onLeave?: () => void;
};

export default function GameView({
    room,
    users,
    positions,
    userId,
    currentTurn,
    bombStatus,
    currentWord,
    currentInput,
    isStarted,
    isSpectator = false,
    serverError = null,
    connectionAlert,
    result,
    lostDisplayName,
    bombRef,
    explosionLayer,
    resultExtraActions,
    onSuccess,
    onChangeInput,
    onPlayAgain,
    onCreateRoom,
    onJoin,
    onWatch,
    onStartGame,
    onLeave,
}: Readonly<Props>) {
    const currentTurnUser = users[currentTurn] as User | undefined;
    const isParticipant = users.some((user) => user.id === userId);
    const hasDuplicateMeaning =
        currentWord !== null &&
        (room?.words?.filter((word) => word.jp === currentWord.jp).length ??
            0) > 1;
    const roomHasSpace =
        typeof room?.maxPlayers === "number" &&
        room.maxPlayers > 0 &&
        users.length < room.maxPlayers;

    const activeGame =
        currentWord === null ? (
            <div
                className="font-mono w-fit font-bold text-2xl"
                data-cursor="text"
            >
                ゲーム開始
            </div>
        ) : (
            <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                {currentTurnUser?.id === userId ? (
                    <div
                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                        data-cursor="text"
                    >
                        あなたの番です
                    </div>
                ) : currentTurnUser ? (
                    <div
                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                        data-cursor="text"
                    >
                        {currentTurnUser.displayName + "の番です"}
                    </div>
                ) : null}
                <TypingView
                    hasDuplicateMeaning={hasDuplicateMeaning}
                    japanese={currentWord.jp}
                    english={currentWord.en}
                    bombStatus={bombStatus}
                    onSuccess={onSuccess}
                    onChangeInput={(input) => {
                        if (userId === currentTurnUser?.id)
                            onChangeInput(input);
                    }}
                    currentInput={
                        result !== null
                            ? ""
                            : userId === currentTurnUser?.id
                              ? null
                              : currentInput
                    }
                />
            </div>
        );

    return (
        <div className="flex flex-col md:flex-row w-full h-full">
            {explosionLayer}
            {connectionAlert !== undefined && (
                <div
                    className={`${!connectionAlert && "opacity-0 scale-95"} transition-all duration-(--duration-etb) ease-etb fixed top-4 right-4 flex items-center gap-4 w-94 rounded-2xl bg-(--color-foreground) text-(--color-background) py-3 px-4`}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        height="24px"
                        viewBox="0 -960 960 960"
                        width="24px"
                        fill="currentColor"
                    >
                        <path d="m696-80-56-56 84-84-84-84 56-56 84 84 84-84 56 56-83 84 83 84-56 56-84-83-84 83Zm-216 0q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 10-.5 20t-1.5 20h-81q2-10 2.5-20t.5-20q0-20-2.5-40t-7.5-40H654q3 20 4.5 40t1.5 40v20q0 10-1 20h-80q1-10 1-20v-20q0-20-1.5-40t-4.5-40H386q-3 20-4.5 40t-1.5 40q0 20 1.5 40t4.5 40h174v80H404q12 43 31 82.5t45 75.5q18 0 35.5-2t35.5-4l18 78q-23 5-44.5 7.5T480-80ZM170-400h136q-3-20-4.5-40t-1.5-40q0-20 1.5-40t4.5-40H170q-5 20-7.5 40t-2.5 40q0 20 2.5 40t7.5 40Zm34-240h118q9-37 22.5-72.5T376-782q-55 18-99 54.5T204-640Zm172 462q-18-34-31.5-69.5T322-320H204q29 51 73 87.5t99 54.5Zm28-462h152q-12-43-31-82.5T480-798q-26 36-45 75.5T404-640Zm234 0h118q-29-51-73-87.5T584-782q18 34 31.5 69.5T638-640Z" />
                    </svg>
                    <div
                        className="flex flex-col"
                        data-cursor={connectionAlert ? "text" : undefined}
                    >
                        <span className="font-bold">接続が切れました</span>
                        プレイヤーがルームから退出しました。
                    </div>
                </div>
            )}

            {result !== null && (
                <div className="bomb-result-enter fixed flex items-center flex-col gap-4 justify-center bg-(--color-background)/75 z-1 top-0 left-0 w-screen h-screen">
                    <div className="w-sm flex flex-col gap-4 items-center animate-appear">
                        <div data-cursor="text" className="font-bold text-4xl">
                            {result
                                ? "あなたの負けです"
                                : `${lostDisplayName ?? "相手"}の負けです`}
                        </div>
                        <Button
                            iconName="rotateCw"
                            className="w-full"
                            variant="primary"
                            onClick={onPlayAgain}
                        >
                            もう一度プレイ
                        </Button>
                        <Button
                            iconName="plus"
                            className="w-full"
                            onClick={onCreateRoom}
                        >
                            ルームを作成
                        </Button>
                        {resultExtraActions}
                    </div>
                </div>
            )}

            <div className="max-w-3xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col">
                <div
                    className={`flex flex-col bg-(--color-background-secondary) transition-all duration-(--duration-etb) ease-etb ${serverError ? "min-h-14 h-auto justify-center" : isSpectator && !isStarted ? "opacity-0 scale-95" : isParticipant ? (isStarted ? (currentTurnUser?.id === userId ? "h-full" : "h-68") : "h-48") : isStarted ? "h-64" : "h-14"} rounded-2xl p-2 w-full`}
                >
                    {serverError ? (
                        <div
                            className="flex justify-start animate-appear w-full"
                            role="alert"
                        >
                            <div
                                className="font-mono w-fit pl-4 font-bold"
                                data-cursor="text"
                            >
                                {serverError}
                            </div>
                        </div>
                    ) : room ? (
                        isParticipant ? (
                            <div className="flex flex-col h-full animate-appear">
                                <div className="flex h-full">
                                    <div className="w-full flex flex-col items-center justify-center gap-4">
                                        {isStarted ? (
                                            activeGame
                                        ) : (
                                            <>
                                                <div
                                                    className="gradient-text h-fit px-2 py-1 font-bold flex"
                                                    data-cursor="text"
                                                >
                                                    ほかのプレイヤーを待っています…
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape={
                                                        users.length < 2
                                                            ? "2"
                                                            : "0"
                                                    }
                                                >
                                                    <button
                                                        className={`items-center cursor-pointer font-bold ${users.length < 2 ? "opacity-50" : "active:scale-95"} bg-cyan-600 disabled:opacity-50 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all duration-(--duration-etb) ease-etb`}
                                                        onClick={() => {
                                                            if (
                                                                users.length > 1
                                                            )
                                                                onStartGame?.();
                                                        }}
                                                    >
                                                        ゲームを開始
                                                    </button>
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape="1"
                                                >
                                                    <button
                                                        className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                        onClick={onLeave}
                                                    >
                                                        退出
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full w-full flex justify-center items-center">
                                {roomHasSpace ? (
                                    isStarted ? (
                                        activeGame
                                    ) : (
                                        !isSpectator && (
                                            <>
                                                <div className="w-full animate-appear">
                                                    <div
                                                        className="w-fit pl-4 font-bold"
                                                        data-cursor="text"
                                                    >
                                                        接続しました
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 animate-appear">
                                                    <div
                                                        className="rounded-lg w-14 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="1"
                                                    >
                                                        <button
                                                            className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={onWatch}
                                                        >
                                                            観戦
                                                        </button>
                                                    </div>
                                                    <div
                                                        className="rounded-lg w-20 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="0"
                                                    >
                                                        <button
                                                            className="items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all cursor-pointer duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={onJoin}
                                                        >
                                                            参加
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    )
                                ) : (
                                    <div className="flex justify-start animate-appear w-full">
                                        <div
                                            className="font-mono w-fit pl-4 font-bold"
                                            data-cursor="text"
                                        >
                                            このルームは満員です
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full h-full flex animate-appear items-center">
                            <div
                                className="w-fit pl-4 font-bold gradient-text"
                                data-cursor="text"
                            >
                                サーバーに接続しています…
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="w-full relative md:order-1 flex justify-center items-center h-full">
                <div
                    className="absolute top-0 left-0 pl-4 md:top-3 w-full flex truncate line-clamp-1 font-bold font-mono text-lg"
                    data-cursor="text"
                >
                    {room?.title}
                </div>
                <UsersView
                    bombRef={bombRef}
                    exploded={result !== null}
                    users={users}
                    positions={positions}
                    userId={userId}
                    currentTurn={isStarted ? currentTurn : null}
                    bombStatus={bombStatus}
                />
            </div>
        </div>
    );
}
