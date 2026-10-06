import TypingView from "@/components/feature/InputView";
import type { TypedRecallItem } from "@/type";

type Props = {
    item: TypedRecallItem;
    currentInput: string | null;
    bombStatus: number;
    hasDuplicatePrompt?: boolean;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
};

export default function TypedRecallView({
    item,
    currentInput,
    bombStatus,
    hasDuplicatePrompt = false,
    onSuccess,
    onChangeInput,
}: Readonly<Props>) {
    return (
        <TypingView
            hasDuplicateMeaning={hasDuplicatePrompt}
            japanese={item.prompt}
            english={item.answer}
            bombStatus={bombStatus}
            onSuccess={onSuccess}
            onChangeInput={onChangeInput}
            currentInput={currentInput}
        />
    );
}
