import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import type { Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { capturePostHogEvent } from "./lib/posthog";
import { createSocketRateLimit } from "./lib/socketRateLimit";
import { roomDatabase } from "./lib/db";
import { probeRoomDatabase } from "./lib/databaseHealth";
import { createDatabaseProbeRateLimit } from "./lib/databaseProbeRateLimit";
import {
    logError,
    logEvent,
    recordLatencySample,
    setServerState,
    startConsole,
} from "./lib/console";

class ClientError extends Error {}

const MAX_DISPLAY_NAME_LENGTH = 50;
// Keep in sync with the client's typing payload limit (maximum typed-recall answer length).
const MAX_CURRENT_INPUT_LENGTH = 32;
const INVALID_DISPLAY_NAME_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const validateDisplayName = (displayName: unknown): string => {
    if (typeof displayName !== "string") {
        throw new ClientError("表示名が不正です。");
    }

    if (
        displayName.length === 0 ||
        displayName.length > MAX_DISPLAY_NAME_LENGTH ||
        INVALID_DISPLAY_NAME_CHARACTERS.test(displayName)
    ) {
        throw new ClientError("表示名が不正です。");
    }

    return displayName;
};

const requireRoomItems = (room: Room) => {
    if (!room.items?.length) {
        throw new ClientError(
            "ルームに問題が設定されていません。問題を設定してから再度お試しください。",
        );
    }
};

const itemsToLegacyWireWords = (room: Room) =>
    room.items?.map((item) => ({
        jp: item.prompt,
        en: item.answer,
    })) ?? [];

let rooms: Room[] = [];
const pendingRoomLoads = new Map<string, Promise<Room | null>>();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});
const acceptDatabaseProbe = createDatabaseProbeRateLimit();

const refreshServerState = () =>
    setServerState({
        rooms: rooms.map((room) => ({
            id: room.id,
            players: (room.users ?? []).map((player) => ({
                id: player.id,
                displayName: player.displayName,
            })),
            isStart: Boolean(room.isStart),
            bombHolder: room.bombHolder,
        })),
    });

const createRoomIfNeeded = (roomId: string): Promise<Room | null> => {
    const existingRoom = rooms.find((item) => item.id === roomId);
    if (existingRoom) return Promise.resolve(existingRoom);

    const pendingLoad = pendingRoomLoads.get(roomId);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async () => {
        const room = await getRoomFromId(roomId);
        if (!room) return null;
        requireRoomItems(room);

        const roomAfterFetch = rooms.find((item) => item.id === roomId);
        if (roomAfterFetch) return roomAfterFetch;

        const newRoom: Room = {
            ...room,
            users: [],
            isStart: false,
            gameId: undefined,
            bombStatus: 0,
            bombHolder: 0,
        };

        rooms.push(newRoom);
        refreshServerState();
        logEvent("ROOM", `created ${roomId}`, { roomId });
        return newRoom;
    })();

    pendingRoomLoads.set(roomId, loadPromise);

    return loadPromise.finally(() => {
        if (pendingRoomLoads.get(roomId) === loadPromise) {
            pendingRoomLoads.delete(roomId);
        }
    });
};

const sendRoomInfo = (roomId: string | null) => {
    if (!roomId) return;
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;
    io.to(roomId).emit("room:broadcast", {
        ...room,
        words: itemsToLegacyWireWords(room),
        password: undefined,
        bombTimer: undefined,
    });
};

const sendInputUpdate = (roomId: string | null, input: string) => {
    if (!roomId) return;
    const room = rooms.find((item) => item.id === roomId);
    if (!room?.isStart || !room.users?.length) return;
    io.to(roomId).emit("typing:input", { input });
};

io.on("connection", (socket) => {
    socket.use(createSocketRateLimit());

    let pingStartedAt: number | undefined;
    socket.conn.on("packetCreate", (packet) => {
        if (packet.type === "ping") pingStartedAt = performance.now();
    });
    socket.conn.on("packet", (packet) => {
        if (packet.type !== "pong" || pingStartedAt === undefined) return;
        recordLatencySample(performance.now() - pingStartedAt);
        pingStartedAt = undefined;
    });

    let user: User = { id: socket.id };
    let roomId: null | string = null;
    const getRoomIndex = () => rooms.findIndex((item) => item.id === roomId);
    logEvent("SERVER", "client connected", { socketId: socket.id });
    socket.emit("auth:request");

    socket.on("health:ping", (pingId: unknown) => {
        if (
            typeof pingId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                pingId,
            )
        )
            return;
        socket.emit("health:pong", pingId);
    });

    socket.on("health:database", async (requestId: unknown) => {
        if (
            typeof requestId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                requestId,
            )
        )
            return;

        // This budget is shared by every connection from an address, so opening
        // a new unauthenticated socket cannot reset access to the database.
        if (!acceptDatabaseProbe(socket.handshake.address)) return;

        const startedAt = performance.now();
        try {
            await probeRoomDatabase(roomDatabase);
            socket.emit("health:database-result", {
                requestId,
                ok: true,
                latencyMs: Math.round(performance.now() - startedAt),
            });
        } catch (error) {
            logError("Database health check failed", error, {
                socketId: socket.id,
            });
            socket.emit("health:database-result", {
                requestId,
                ok: false,
                latencyMs: null,
            });
        }
    });

    const reportError = (
        message: string,
        error: unknown = new Error(message),
    ) => {
        logError(message, error, {
            socketId: socket.id,
            userId: user.id,
            displayName: user.displayName,
            roomId,
        });
        socket.emit("error", { message });
    };

    socket.on("room:join", () => {
        if (!roomId) return;

        const room = rooms.find((item) => item.id === roomId);
        if (!room) return;

        const maxPlayers = room.maxPlayers;
        const users = room.users ?? (room.users = []);
        if (!maxPlayers || users.length >= maxPlayers) return;
        socket.join(roomId);
        if (!users.some((u) => u.id === user.id)) {
            users.push({ id: user.id, displayName: user.displayName });
            refreshServerState();
            logEvent("ROOM", `player joined ${roomId}`, {
                roomId,
                socketId: socket.id,
                userId: user.id,
                displayName: user.displayName,
            });
            capturePostHogEvent("player_joined", {
                player_count: users.length,
            });
        }
        sendRoomInfo(roomId);
    });

    const leaveRoom = () => {
        if (!roomId) return;
        // Game-room membership is separate from Socket.IO membership.
        // Keep the socket in the Socket.IO room so the same connection can rejoin.
        deleteUser(user.id, "room_leave");
    };
    socket.on("room:leave", leaveRoom);

    socket.on(
        "auth:response",
        async (response: { jwtToken: string; displayName: string }) => {
            try {
                if (!response || typeof response.jwtToken !== "string") {
                    throw new ClientError(
                        "認証情報が不正です。ルームに入り直してください。",
                    );
                }
                const jwtResult = await verifyToken(response.jwtToken);
                if (!jwtResult) {
                    throw new ClientError(
                        "認証トークンが無効または有効期限切れです。ルームに入り直してください。",
                    );
                }

                const room = await createRoomIfNeeded(jwtResult);
                if (!room) {
                    throw new ClientError(
                        "ルーム情報を取得できませんでした。ルームを確認して再度お試しください。",
                    );
                }
                requireRoomItems(room);

                const displayName = validateDisplayName(response.displayName);

                roomId = jwtResult;
                user = { ...user, displayName };
                socket.join(roomId);
                logEvent("ROOM", `authenticated ${roomId}`, {
                    roomId,
                    socketId: socket.id,
                    userId: user.id,
                    displayName: user.displayName,
                });
                capturePostHogEvent("room_authenticated");
                sendRoomInfo(roomId);
            } catch (error) {
                reportError(
                    error instanceof ClientError
                        ? error.message
                        : "認証またはルーム情報の取得に失敗しました。しばらくしてから再度お試しください。",
                    error,
                );
            }
        },
    );

    const handleCurrentInput = (input: unknown) => {
        if (typeof input !== "string") return;
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;
        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];
        if (!room.isStart || !currentUser || currentUser.id !== user.id) return;
        sendInputUpdate(roomId, input.slice(0, MAX_CURRENT_INPUT_LENGTH));
    };
    socket.on("currentInput", handleCurrentInput);

    socket.on("word:success", () => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;
        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];
        if (
            !room.isStart ||
            room.bombHolder === undefined ||
            !currentUser ||
            currentUser.id !== user.id ||
            !room.users?.length
        )
            return;
        const previousHolder = currentUser;
        room.bombHolder = (room.bombHolder + 1) % room.users.length;
        const nextHolder = room.users[room.bombHolder];
        if (room.items?.length)
            room.wordIndex = Math.floor(Math.random() * room.items.length);
        refreshServerState();
        logEvent("GAME", `word passed in ${roomId}`, {
            roomId,
            gameId: room.gameId,
            socketId: socket.id,
            userId: user.id,
            displayName: user.displayName,
            previousHolder: {
                userId: previousHolder.id,
                displayName: previousHolder.displayName,
            },
            nextHolder: nextHolder
                ? {
                      userId: nextHolder.id,
                      displayName: nextHolder.displayName,
                  }
                : undefined,
        });
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);
    });

    socket.on("game:start", async () => {
        const index = getRoomIndex();
        if (index === -1) return;
        const room = rooms[index];
        if (!room.users || room.users.length < 2 || room.isStart) return;
        try {
            const savedRoom = await getRoomFromId(room.id);
            if (!savedRoom) {
                reportError("ルームの設定を取得できませんでした。");
                return;
            }
            if (!rooms.includes(room) || room.isStart || roomId !== room.id)
                return;
            room.gameDuration = savedRoom.gameDuration;
            requireRoomItems(room);
        } catch (error) {
            reportError((error as ClientError).message, error);
            return;
        }
        if (!room.users || room.users.length < 2 || room.isStart) return;
        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }
        const gameId = randomUUID();
        room.gameId = gameId;
        room.isStart = true;
        room.bombHolder = Math.floor(Math.random() * room.users.length);
        room.wordIndex = undefined;
        room.bombStatus = 0;
        refreshServerState();
        logEvent("GAME", `started ${roomId}`, {
            roomId,
            gameId,
            starter: {
                socketId: socket.id,
                userId: user.id,
                displayName: user.displayName,
            },
            players: room.users.map((player) => ({
                userId: player.id,
                displayName: player.displayName,
            })),
        });
        capturePostHogEvent("game_started", {
            player_count: room.users.length,
        });
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);
        setTimeout(() => {
            const currentRoomIndex = getRoomIndex();
            if (currentRoomIndex === -1) return;
            const currentRoom = rooms[currentRoomIndex];
            if (currentRoom.gameId !== gameId || !currentRoom.isStart) return;
            if (currentRoom.items?.length)
                currentRoom.wordIndex = Math.floor(
                    Math.random() * currentRoom.items.length,
                );
            sendInputUpdate(roomId, "");
            sendRoomInfo(roomId);
        }, 3000);
        const changeBombStatus = () => {
            const roomIndex = getRoomIndex();
            if (roomIndex === -1) return;
            const currentRoom = rooms[roomIndex];
            if (currentRoom.gameId !== gameId || !currentRoom.isStart) return;
            const configuredDuration = currentRoom.gameDuration ?? 20;
            const baseDuration =
                Number.isInteger(configuredDuration) &&
                configuredDuration >= 1 &&
                configuredDuration <= 2147473
                    ? configuredDuration
                    : 20;
            const duration = (baseDuration + Math.random() * 10) * 1000;
            currentRoom.bombTimer = setTimeout(() => {
                const currentRoomIndex = getRoomIndex();
                if (currentRoomIndex === -1) return;
                const currentRoom = rooms[currentRoomIndex];
                if (currentRoom.gameId !== gameId || !currentRoom.isStart)
                    return;
                if (currentRoom.bombStatus === 4) {
                    if (!roomId) return;
                    const lostUser =
                        currentRoom.users?.[currentRoom.bombHolder!];
                    if (lostUser)
                        io.to(roomId).emit("game:end", {
                            holderUserId: lostUser.id,
                            holderDisplayName: lostUser.displayName,
                        });
                    resetGameStatus(gameId);
                    logEvent("GAME", `ended ${roomId}`, {
                        roomId,
                        gameId,
                        holder: lostUser
                            ? {
                                  userId: lostUser.id,
                                  displayName: lostUser.displayName,
                              }
                            : undefined,
                        players: currentRoom.users?.map((player) => ({
                            userId: player.id,
                            displayName: player.displayName,
                        })),
                    });
                    capturePostHogEvent("game_finished", {
                        player_count: currentRoom.users?.length ?? 0,
                    });
                    currentRoom.users = [];
                    refreshServerState();
                    logEvent("ROOM", `players kicked after game ${roomId}`, {
                        roomId,
                        gameId,
                    });
                    sendInputUpdate(roomId, "");
                    sendRoomInfo(roomId);
                } else {
                    currentRoom.bombStatus = (currentRoom.bombStatus ?? 0) + 1;
                    sendRoomInfo(roomId);
                    changeBombStatus();
                }
            }, duration);
        };
        changeBombStatus();
    });

    const resetGameStatus = (expectedGameId?: string) => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;
        const room = rooms[roomIndex];
        if (expectedGameId && room.gameId !== expectedGameId) return;
        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }
        room.isStart = false;
        room.gameId = undefined;
        room.bombStatus = 0;
        room.bombHolder = 0;
        room.wordIndex = undefined;
        refreshServerState();
        sendInputUpdate(roomId, "");
    };

    const deleteUser = (
        userId: string,
        reason: "disconnect" | "room_leave",
    ) => {
        if (!roomId) return;
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;
        const room = rooms[roomIndex];
        const leavingUser = room.users?.find((item) => item.id === userId);
        if (leavingUser) {
            if (room.isStart) {
                const gameId = room.gameId;
                resetGameStatus();
                io.to(roomId).emit("game:quited");
                logEvent("GAME", `cancelled ${roomId}`, {
                    roomId,
                    gameId,
                    socketId: socket.id,
                    userId: leavingUser.id,
                    displayName: leavingUser.displayName,
                });
                capturePostHogEvent("game_cancelled", {
                    reason,
                    player_count: room.users?.length ?? 0,
                });
                room.users = [];
            } else {
                room.users = (room.users ?? []).filter(
                    (item) => item.id !== userId,
                );
            }
            refreshServerState();
            logEvent("ROOM", `player left ${roomId}`, {
                roomId,
                socketId: socket.id,
                userId: leavingUser.id,
                displayName: leavingUser.displayName,
                remainingPlayers: room.users?.map((player) => ({
                    userId: player.id,
                    displayName: player.displayName,
                })),
            });
            capturePostHogEvent("player_left", {
                reason,
                player_count: room.users?.length ?? 0,
            });
        }
        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketRoom || socketRoom.size === 0) {
            if (room.bombTimer) clearTimeout(room.bombTimer);
            rooms = rooms.filter((item) => item.id !== roomId);
            refreshServerState();
            logEvent("ROOM", `deleted ${roomId}`, { roomId });
        } else {
            sendInputUpdate(roomId, "");
        }
        sendRoomInfo(roomId);
    };

    socket.on("disconnect", () => {
        logEvent("SERVER", "client disconnected", {
            socketId: socket.id,
            userId: user.id,
            displayName: user.displayName,
            roomId,
        });
        deleteUser(user.id, "disconnect");
    });
});

httpServer.listen(3001, () => {
    startConsole(3001);
});
