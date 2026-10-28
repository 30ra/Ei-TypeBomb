"use server";

import { getPlaygroundRoom } from "@/lib/room/playground";
import { getRoomItems, isTypedRecallItem } from "@/lib/item";

/** Load the currently selected Ei-TypeBomb room's word list. */
export async function getBattleWords() {
    const room = await getPlaygroundRoom();
    if (!room) return null;
    return {
        title: room.title,
        words: getRoomItems(room)
            .filter(isTypedRecallItem)
            .filter((item) => item.prompt.trim() && item.answer.trim())
            .map((item) => ({ prompt: item.prompt, answer: item.answer })),
    };
}
