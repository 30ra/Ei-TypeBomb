import { roomDatabase } from "./db";
import type { Room } from "../type";

type RoomRow = {
    id: string;
    title: string | null;
    user_id: string | null;
    explanation: string | null;
    max_players: number | null;
    game_duration: number | null;
    password: string | null;
    created_at: string | null;
    updated_at: string | null;
    words: Room["words"] | null;
};

export const getRoomFromId = async (id: string) => {
    try {
        const { rows } = await roomDatabase.query<RoomRow>(
            `SELECT
                id,
                title,
                user_id,
                explanation,
                max_players,
                game_duration,
                password,
                created_at,
                updated_at,
                words
            FROM public.ei_typebomb_rooms
            WHERE id = $1
            LIMIT 1`,
            [id],
        );

        const data = rows[0];
        if (!data) return;

        return {
            id: data.id,
            title: data.title ?? undefined,
            userId: data.user_id ?? undefined,
            explanation: data.explanation ?? undefined,
            maxPlayers: data.max_players ?? undefined,
            gameDuration: data.game_duration ?? 20,
            password: data.password,
            createdAt: data.created_at ?? undefined,
            updatedAt: data.updated_at ?? undefined,
            words: data.words ?? undefined,
        } as Room;
    } catch (error) {
        console.error(
            "Failed to read room from PostgreSQL:",
            error instanceof Error ? error.message : error,
        );
        return;
    }
};
