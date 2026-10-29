// Shared recall model. Based on the original playground evaluation rules.
export const RECENT_EXPOSURE_MS = 3000;
export const HEAVY_CUE_RATIO = 0.4;
export const FAST_RECALL_LATENCY_MS = 2500;
export const FAST_READING_ALLOWANCE_MS = 2000;
export const SLOW_READING_ALLOWANCE_MS = 6000;
export const DEFAULT_EXPECTED_CHAR_MS = 220;
export type RecallObservation = {success:boolean; answerLength:number; firstAttemptCorrect:boolean; revealedHintChars:number; attemptCount:number; hintCount:number; elapsedMs:number; recallLatencyMs:number|null; answerWasFullyRevealed?:boolean; finalCueRatio?:number; initialCueRatio?:number; additionalHintCount?:number; elapsedSincePresentationMs?:number|null; expectedTypingMs?:number; incorrectInputCount?:number};
export type AttemptEvaluation = {memoryEvidence:"strong_recall"|"recall"|"weak_recall"|"insufficient_evidence";retryNeed:"none"|"confirm"|"short";reason:"failed_recall"|"heavy_hint"|"uncertain_recall"|null;independent:boolean};
export const evaluateRecall = (
    observation: RecallObservation,
): AttemptEvaluation => {
    const cue = Math.max(
        observation.initialCueRatio ?? 0,
        observation.finalCueRatio ??
            observation.revealedHintChars /
                Math.max(1, observation.answerLength),
    );
    const full = observation.answerWasFullyRevealed || cue >= 1;
    const independent =
        observation.elapsedSincePresentationMs == null ||
        observation.elapsedSincePresentationMs >= RECENT_EXPOSURE_MS;
    if (!observation.success || full)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: "short",
            reason: !observation.success ? "failed_recall" : "heavy_hint",
            independent,
        };
    if (cue >= HEAVY_CUE_RATIO)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "short",
            reason: "heavy_hint",
            independent,
        };
    if (!independent)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: "confirm",
            reason: "uncertain_recall",
            independent,
        };
    if (cue > 0 || (observation.additionalHintCount ?? 0) > 0)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "confirm",
            reason: "uncertain_recall",
            independent,
        };
    const expected =
        observation.expectedTypingMs ??
        observation.answerLength * DEFAULT_EXPECTED_CHAR_MS;
    const errors =
        observation.incorrectInputCount ??
        Math.max(0, observation.attemptCount - 1);
    const fast =
        observation.recallLatencyMs !== null &&
        observation.recallLatencyMs <= FAST_RECALL_LATENCY_MS &&
        observation.elapsedMs <= FAST_READING_ALLOWANCE_MS + expected * 1.5;
    if (errors === 0 && observation.firstAttemptCorrect && fast)
        return {
            memoryEvidence: "strong_recall",
            retryNeed: "none",
            reason: null,
            independent,
        };
    // One promptly corrected typo is not a recall failure.
    if (
        errors <= 1 &&
        observation.elapsedMs <= SLOW_READING_ALLOWANCE_MS + expected * 2
    )
        return {
            memoryEvidence: "recall",
            retryNeed: "none",
            reason: null,
            independent,
        };
    return {
        memoryEvidence: "weak_recall",
        retryNeed: "confirm",
        reason: "uncertain_recall",
        independent,
    };
};

