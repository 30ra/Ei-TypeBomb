import type { Item, Room, TypedRecallItem } from "@/type";

export const getRoomItems = (
    room: Pick<Room, "items"> | null | undefined,
): Item[] => room?.items ?? [];

export const isTypedRecallItem = (
    item: Item | null | undefined,
): item is TypedRecallItem => item?.type === "typed_recall";
