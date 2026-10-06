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
    items?: Item[];
    maxPlayers?: number;
    gameDuration?: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
    users?: User[];
    isStart?: boolean;
    gameId?: string;
    bombHolder?: number;
    wordIndex?: number;
    bombStatus: number;
    bombTimer?: NodeJS.Timeout;
};

export type User = {
    id: string;
    displayName?: string;
    pulse?: string;
};
