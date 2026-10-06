import type { Item, LegacyWord, Room, TypedRecallItem } from "@/type";

const hashString = (value: string) => {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
};

export const legacyWordToItem = (word: LegacyWord): TypedRecallItem => ({
    id: `legacy-${hashString(`${word.jp}\u0000${word.en}`)}`,
    type: "typed_recall",
    prompt: word.jp,
    answer: word.en,
});

export const getRoomItems = (
    room: Pick<Room, "items" | "words"> | null | undefined,
): Item[] => {
    if (!room) return [];
    if (room.items?.length) return room.items;
    return room.words?.map(legacyWordToItem) ?? [];
};

export const isTypedRecallItem = (
    item: Item | null | undefined,
): item is TypedRecallItem => item?.type === "typed_recall";
