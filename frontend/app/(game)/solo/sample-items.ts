import type { Item } from "@/type";

export const SAMPLE_ITEMS: Item[] = [
    ["りんご", "apple"],
    ["川", "river"],
    ["光", "light"],
    ["緑", "green"],
    ["雲", "cloud"],
    ["音楽", "music"],
    ["庭", "garden"],
    ["海", "ocean"],
    ["窓", "window"],
    ["鉛筆", "pencil"],
    ["森", "forest"],
    ["ロケット", "rocket"],
    ["冬", "winter"],
    ["惑星", "planet"],
    ["橋", "bridge"],
    ["銀", "silver"],
    ["カメラ", "camera"],
    ["オレンジ", "orange"],
].map(([prompt, answer]) => ({
    id: answer,
    type: "typed_recall",
    prompt,
    answer,
}));
