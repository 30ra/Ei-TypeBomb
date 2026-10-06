export type LegacyWord = {
    jp: string;
    en: string;
};

export type TypedRecallItem = {
    id: string;
    type: "typed_recall";
    prompt: string;
    answer: string;
};

export type Item = TypedRecallItem;

export type Room = {
    id: string;
    userId?: string;
    title?: string;
    explanation?: string;
    /**
     * Canonical in-app content model. New gameplay code should read this.
     */
    items?: Item[];
    /**
     * Legacy wire/storage shape kept while existing rooms and servers migrate.
     * Normalize through getRoomItems() before gameplay code consumes it.
     */
    words?: LegacyWord[];
    maxPlayers?: number;
    gameDuration?: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
    link?: string;
};

export type User = {
    id: string;
    displayName?: string;
    pulse?: string;
};

export type Position = {
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
};
