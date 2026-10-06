export const correctPrefixLength = (input: string[], answer: string) => {
    let length = 0;
    while (length < answer.length && input[length] === answer[length]) length++;
    return length;
};

export const getInitialCueLength = (
    length: number,
    ratio: number,
    baseHints = 0,
) => Math.max(baseHints, ratio >= 1 ? length : Math.min(Math.max(0, length - 1), Math.ceil(length * ratio)));

export const hintCoversError = (input: string[], answer: string, length: number) =>
    input.some((char, index) => index < length && char !== "" && char !== answer[index]);
