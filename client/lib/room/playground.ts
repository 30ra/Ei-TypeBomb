"use server";

import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import isUUID from "validator/es/lib/isUUID";
import type { Room } from "@/type";
import { createAdminClient } from "@/lib/db/server";
import { serverError } from "@/lib/server-console";

export const getPlaygroundRoom = async (): Promise<Room | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get("jwt_token")?.value;
    if (!token) return null;

    let roomId: string;

    try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
        });

        if (typeof payload.id !== "string" || !isUUID(payload.id, 4)) {
            return null;
        }

        roomId = payload.id;
    } catch {
        return null;
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, created_at, updated_at, items, link, game_duration",
        )
        .eq("id", roomId)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch playground room", error, "DB");
        return null;
    }

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        return null;
    }

    return {
        id: data.id,
        title: data.title,
        userId: data.user_id,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        gameDuration: data.game_duration ?? 20,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items: data.items,
        link: data.link,
    } as Room;
};
