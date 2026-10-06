import TypedRecallView from "@/components/feature/TypedRecallView";
import type { Item } from "@/type";

type Props = {
    item: Item;
    currentInput: string | null;
    bombStatus: number;
    hasDuplicatePrompt?: boolean;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
};

export default function ItemView(props: Readonly<Props>) {
    switch (props.item.type) {
        case "typed_recall":
            return <TypedRecallView {...props} item={props.item} />;
    }
}
