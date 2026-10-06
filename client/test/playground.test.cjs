/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(file, globals = {}) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    return evaluate(source, globals);
}
function evaluate(source, globals = {}) {
    const scope = { exports: {}, ...globals };
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        scope,
    );
    return scope.exports;
}
const memory = load("lib/playground/memory.ts");
const input = load("lib/playground/recall-input.ts");
const clock = load("lib/playground/bomb-clock.ts");
const now = new Date("2026-10-06T00:00:00Z");
const item = (id, length = 5) => ({
    id,
    type: "typed_recall",
    prompt: id,
    answer: "a".repeat(length),
});
const initial = (id = "a") => ({
    ...memory.createInitialMemory("u", "r", id),
    reviewCount: 1,
    lastReviewedAt: now.toISOString(),
});
const state = (phase = "supported_recall", turn = 0) => ({
    phase,
    freeRecallSuccesses: 0,
    lastFreeRecallTurn: null,
    lastSeenTurn: turn,
    lastCueRatio: 0.5,
    relearningSinceLastFreeRecall: false,
    cueSuccessStreak: 0,
});
const observation = (ratio = 0, extra = {}) => ({
    success: true,
    answerLength: 5,
    firstAttemptCorrect: true,
    attemptCount: 1,
    hintCount: ratio ? 1 : 0,
    revealedHintChars: ratio * 5,
    maxCorrectPrefixLength: 5,
    recallLatencyMs: 500,
    elapsedMs: 1500,
    finalCueRatio: ratio,
    outcome: ratio >= 1 ? "relearned" : ratio ? "cued_recall" : "free_recall",
    reviewContext: "scheduled",
    ...extra,
});
const apply = (m, o, date = now) =>
    memory.applyRecallObservation({
        memory: m,
        observation: o,
        userId: "u",
        roomId: "r",
        itemId: "a",
        now: date,
    });

test("recent BOT exposure is early-extra, while enough turns or elapsed time permits retrieval", () => {
    const m = { ...initial(), lastPresentedAt: now.toISOString() };
    assert.equal(
        memory.getReviewContext(m, "free_recall", 10, 14, now.getTime() + 1000),
        "early_extra",
    );
    assert.equal(
        memory.getReviewContext(m, "free_recall", 10, 15, now.getTime() + 1000),
        "scheduled",
    );
    assert.equal(
        memory.getReviewContext(
            m,
            "free_recall",
            10,
            11,
            now.getTime() + 30000,
        ),
        "scheduled",
    );
    const prior = {
        ...state("free_recall"),
        freeRecallSuccesses: 1,
        lastFreeRecallTurn: 10,
    };
    assert.equal(
        memory.updateSessionLearning(
            prior,
            observation(0, { elapsedSincePresentationMs: 30000 }),
            11,
        ).phase,
        "graduated",
    );
});

for (const [label, items] of [
    [
        "mixed lengths",
        "abcdefgh".split("").map((id, index) => item(id, index + 1)),
    ],
    ["eight ordinary words", "abcdefgh".split("").map((id) => item(id, 8))],
    ["three ordinary words", "abc".split("").map((id) => item(id, 8))],
    ["hint-assisted words", "abcdefgh".split("").map((id) => item(id, 8))],
    ["full-answer support", "abcdefgh".split("").map((id) => item(id, 8))],
])
    test(`two-player scheduling progresses: ${label}`, () => {
        let memories = {},
            sessions = {},
            recent = [],
            turn = 0,
            time = Date.now();
        const exposures = {};
        const encountered = new Set();
        const needsHelp =
            label === "hint-assisted words" || label === "full-answer support";
        for (let attempt = 0; attempt < 600; attempt++) {
            const next = memory.chooseNextItem({
                items,
                memoryByItem: memories,
                recentItemIds: recent,
                activeRecall: true,
                sessionByItem: sessions,
                currentTurnNumber: turn,
            });
            encountered.add(next.id);
            if (needsHelp && encountered.size === items.length) return;
            if (needsHelp && attempt === 3)
                assert.equal(
                    encountered.size,
                    4,
                    "Introduce the full block before repeating",
                );
            if (needsHelp && attempt >= 50)
                assert.fail(
                    "Hint use trapped practice in " +
                        [...encountered].join(","),
                );
            turn++;
            const existing = sessions[next.id];
            const s = existing?.deferred
                ? { ...existing, deferred: false, practiceAttempts: 0 }
                : (existing ??
                  memory.restoreSessionLearning(memories[next.id], turn));
            const context = memory.getReviewContext(
                memories[next.id],
                s.phase,
                exposures[next.id],
                turn,
                time,
            );
            exposures[next.id] = turn;
            const plan = memory.createTurnPlan(memories[next.id], s);
            const initialRatio =
                input.getInitialCueLength(
                    next.answer.length,
                    plan.initialCueRatio,
                ) / next.answer.length;
            const ratio =
                plan.mode === "encoding"
                    ? 1
                    : label === "full-answer support"
                      ? 1
                      : needsHelp
                        ? Math.max(initialRatio, 0.7)
                        : initialRatio;
            const o = observation(ratio, {
                outcome:
                    plan.mode === "encoding"
                        ? "encoding"
                        : ratio === 0
                          ? "free_recall"
                          : ratio === 1
                            ? "relearned"
                            : "cued_recall",
                initialCueRatio: plan.initialCueRatio,
                additionalHintCount: needsHelp ? 1 : 0,
                reviewContext: context,
                answerLength: next.answer.length,
            });
            time += 1500;
            sessions[next.id] = memory.updateSessionLearning(s, o, turn);
            memories[next.id] = {
                ...memory.applyRecallObservation({
                    memory: memories[next.id],
                    observation: o,
                    userId: "u",
                    roomId: "r",
                    itemId: next.id,
                    now: new Date(time),
                }),
                learningState: memory.persistSessionLearning(sessions[next.id]),
            };
            recent = [...recent, next.id].slice(-12);
            assert(
                Object.values(sessions).filter(
                    (x) => x.phase !== "graduated" && !x.deferred,
                ).length <= 4,
            );
            if (items.every((x) => sessions[x.id]?.phase === "graduated"))
                return;
            const bot = memory.chooseNextItem({
                items,
                memoryByItem: memories,
                recentItemIds: recent,
                activeRecall: false,
                sessionByItem: sessions,
                currentTurnNumber: turn,
            });
            if (bot) {
                turn++;
                time += 1500;
                exposures[bot.id] = turn;
                if (sessions[bot.id])
                    sessions[bot.id] = {
                        ...sessions[bot.id],
                        lastSeenTurn: turn,
                    };
                memories[bot.id] = {
                    ...memories[bot.id],
                    lastPresentedAt: new Date(time).toISOString(),
                };
                recent = [...recent, bot.id].slice(-12);
            }
        }
        assert.fail(
            "The scheduler never completed the set: " +
                JSON.stringify(sessions),
        );
    });

test("rotation retains unfinished learning and resumes deferred items after fresh items", () => {
    let current = state();
    for (
        let attempt = 1;
        attempt <= memory.MAX_PRACTICE_ATTEMPTS_PER_BLOCK;
        attempt++
    ) {
        current = memory.updateSessionLearning(
            current,
            observation(1),
            attempt * 6,
        );
    }
    assert.equal(current.deferred, true);
    assert.equal(current.phase, "supported_recall");
    const saved = memory.persistSessionLearning(current);
    const restored = memory.restoreSessionLearning(
        { ...initial(), learningState: saved },
        100,
    );
    assert.equal(restored.phase, "supported_recall");
    assert.equal(restored.lastCueRatio, current.lastCueRatio);
    assert.equal(restored.deferred, undefined);
    const items = [item("a"), item("b")];
    const params = {
        items,
        memoryByItem: { a: { ...initial(), learningState: saved } },
        recentItemIds: [],
        activeRecall: true,
        sessionByItem: { a: current },
        currentTurnNumber: 100,
    };
    assert.equal(memory.chooseNextItem(params).id, "b");
    assert.equal(
        memory.chooseNextItem({ ...params, items: [items[0]] }).id,
        "a",
    );
});

test("all answer lengths can reach two separated unaided successes", () => {
    for (let length = 1; length <= 30; length++) {
        let s = state();
        for (let trial = 1; trial <= 20 && s.phase !== "graduated"; trial++) {
            const plan = memory.createTurnPlan(initial(), s);
            const cue =
                input.getInitialCueLength(length, plan.initialCueRatio) /
                length;
            s = memory.updateSessionLearning(
                s,
                observation(cue, {
                    answerLength: length,
                    initialCueRatio: plan.initialCueRatio,
                    additionalHintCount: 0,
                }),
                trial * 6,
            );
        }
        assert.equal(s.phase, "graduated", `length=${length}`);
        assert.equal(s.freeRecallSuccesses, 2);
    }
});

test("extra hints prevent cue reduction; full answer resets retrieval successes", () => {
    const current = {
        ...state("free_recall"),
        freeRecallSuccesses: 1,
        lastFreeRecallTurn: 3,
    };
    const failed = memory.updateSessionLearning(current, observation(1), 10);
    assert.equal(failed.phase, "supported_recall");
    assert.equal(failed.freeRecallSuccesses, 0);
    const helped = memory.updateSessionLearning(
        state(),
        observation(0.7, { initialCueRatio: 0.5, additionalHintCount: 1 }),
        10,
    );
    assert.equal(helped.cueSuccessStreak, 0);
    assert.equal(helped.lastCueRatio, 0.7);
});

test("four intervening presentations are required to count the next unaided success", () => {
    const current = {
        ...state("free_recall"),
        freeRecallSuccesses: 1,
        lastFreeRecallTurn: 10,
    };
    assert.equal(
        memory.updateSessionLearning(current, observation(), 14)
            .freeRecallSuccesses,
        1,
    );
    assert.equal(
        memory.updateSessionLearning(current, observation(), 15).phase,
        "graduated",
    );
});

test("early-extra success neither graduates nor shifts the long-term review date", () => {
    const current = {
        ...state("free_recall"),
        freeRecallSuccesses: 1,
        lastFreeRecallTurn: 1,
    };
    const extra = observation(0, { reviewContext: "early_extra" });
    assert.equal(
        memory.updateSessionLearning(current, extra, 10).freeRecallSuccesses,
        1,
    );
    let m = { ...initial(), stability: 1 };
    for (let i = 0; i < 10; i++)
        m = apply(m, extra, new Date(now.getTime() + 1000 * (i + 1)));
    assert.equal(m.stability, 1);
    assert.equal(m.difficulty, 5);
    assert.equal(m.lastReviewedAt, now.toISOString());
    assert.notEqual(m.lastPresentedAt, m.lastReviewedAt);
});

test("zero-delay successes have no fixed stability gain; spaced successes have gain", () => {
    const m = { ...initial(), stability: 1 };
    assert.equal(apply(m, observation()).stability, 1);
    assert(
        apply(m, observation(), new Date(now.getTime() + 86_400_000))
            .stability > 1,
    );
});

test("failure is still evaluated during early-extra practice and does not increase stability", () => {
    const m = apply(
        initial(),
        observation(1, { reviewContext: "early_extra" }),
    );
    assert(m.stability <= 0.15);
    assert(m.difficulty > 5);
    assert.equal(m.lastReviewedAt, now.toISOString());
});

test("fallback never introduces a fifth unfinished word", () => {
    const items = "abcde".split("").map((id) => item(id));
    const sessions = Object.fromEntries(
        "abcd".split("").map((id) => [id, state("free_recall", 10)]),
    );
    const selected = memory.chooseNextItem({
        items,
        memoryByItem: {},
        recentItemIds: ["a", "b", "c", "d"],
        activeRecall: true,
        sessionByItem: sessions,
        currentTurnNumber: 11,
    });
    assert.notEqual(selected.id, "e");
});

test("a one-item BOT cannot expose an unseen answer; users can always continue", () => {
    const args = { items: [item("a")], memoryByItem: {}, recentItemIds: [] };
    assert.equal(memory.chooseNextItem({ ...args, activeRecall: false }), null);
    assert.equal(
        memory.chooseNextItem({ ...args, activeRecall: true }).id,
        "a",
    );
});

test("review count alone is not graduation; explicit phase and successes survive persistence", () => {
    const legacy = { ...initial(), reviewCount: 100 };
    assert.equal(
        memory.restoreSessionLearning(legacy, 0).phase,
        "supported_recall",
    );
    const learningState = memory.persistSessionLearning({
        ...state("graduated"),
        freeRecallSuccesses: 2,
        lastCueRatio: 0,
    });
    const restored = memory.restoreSessionLearning(
        { ...legacy, learningState },
        0,
    );
    assert.equal(restored.phase, "graduated");
    assert.equal(restored.freeRecallSuccesses, 2);
    const row = memory.toMemoryState({
        user_id: "u",
        room_id: "r",
        id: "a",
        stability: 1,
        difficulty: 5,
        review_count: 100,
        last_reviewed_at: now.toISOString(),
        learning_state: learningState,
        last_presented_at: now.toISOString(),
    });
    assert.equal(row.learningState.phase, "graduated");
    assert.equal(row.lastPresentedAt, now.toISOString());
});

test("encoding alone is insufficient for a mastery-based stop recommendation", () => {
    const items = "abcdefgh".split("").map((id) => item(id));
    assert.equal(
        memory.shouldRecommendStop({
            items,
            memoryByItem: Object.fromEntries(
                items.map((x) => [x.id, initial(x.id)]),
            ),
            userReviewCount: 8,
            sessionStartedAt: now.getTime(),
            now: now.getTime(),
        }),
        false,
    );
});

test("difficulty adjusts retrieval time within bounded limits", () => {
    const s = state("free_recall");
    const easy = memory.createTurnPlan({ ...initial(), difficulty: 1 }, s);
    const hard = memory.createTurnPlan({ ...initial(), difficulty: 10 }, s);
    assert(easy.retrievalWindowMs < hard.retrievalWindowMs);
    assert(easy.retrievalWindowMs >= 12000 && hard.retrievalWindowMs <= 26000);
});

test("bomb progress survives alternating turns, respects pauses, and changes speed", () => {
    let progress = 0,
        stages = 0;
    for (let turn = 0; turn < 30; turn++) {
        progress = clock.advanceBombClock(
            progress,
            3000,
            turn % 2 ? 18000 : 22000,
            false,
        );
        if (progress >= 1) {
            stages++;
            progress -= 1;
        }
    }
    assert(stages >= 4);
    assert.equal(clock.advanceBombClock(0.5, 30000, 18000, true), 0.5);
    assert(
        clock.advanceBombClock(0.5, 1000, 24000, false) <
            clock.advanceBombClock(0.5, 1000, 12000, false),
    );
});

test("newly revealed hints distinguish wrong letters from blanks and correct prefixes", () => {
    assert.equal(input.hintCoversError(["Y"], "Hello", 1), true);
    assert.equal(input.hintCoversError(["H", "e", "r"], "Hello", 2), false);
    assert.equal(input.hintCoversError(["H", "e", "r"], "Hello", 3), true);
    assert.equal(input.hintCoversError([""], "Hello", 1), false);
});

// Exercise the real queue callback, including arrivals during an in-flight request.
function getCallback(name, globals) {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/playground/Client.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Client.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(callback);
    const printed = ts
        .createPrinter()
        .printNode(ts.EmitHint.Expression, callback, ast);
    return evaluate("export const callback = " + printed, globals).callback;
}

test("the actual presentation callback resumes deferred practice without losing cue stage", () => {
    const deferred = {
        ...state(),
        lastCueRatio: 0.2,
        cueSuccessStreak: 1,
        practiceAttempts: 10,
        deferred: true,
    };
    const sessions = { current: { a: deferred } };
    let displayed;
    const trackedItem = getCallback("setTrackedItem", {
        currentItemRef: { current: null },
        setCurrentItem: () => {},
        recallProgressRef: { current: null },
        setRecallPressurePaused: () => {},
        sessionTurnNumberRef: { current: 80 },
        setItemPresentationKey: () => {},
        recentItemIdsRef: { current: [] },
        usersRef: { current: [{ id: "local" }] },
        currentTurnRef: { current: 0 },
        LOCAL_USER_ID: "local",
        memoryByItemRef: { current: { a: initial() } },
        lastPresentedTurnRef: { current: { a: 10 } },
        sessionByItemRef: sessions,
        previousPresentationTurnRef: { current: undefined },
        currentReviewContextRef: { current: undefined },
        getReviewContext: memory.getReviewContext,
        restoreSessionLearning: memory.restoreSessionLearning,
        setSessionByItem: (value) => {
            displayed = value;
        },
    });
    trackedItem(item("a"));
    assert.equal(sessions.current.a.deferred, false);
    assert.equal(sessions.current.a.practiceAttempts, 0);
    assert.equal(sessions.current.a.phase, "supported_recall");
    assert.equal(sessions.current.a.lastCueRatio, 0.2);
    assert.equal(sessions.current.a.cueSuccessStreak, 1);
    assert.equal(displayed, sessions.current);
});

test("memory sync serializes newer writes and retains unsent data on rejection", async () => {
    const pending = { current: new Map([["a", initial()]]) };
    const inFlight = { current: null };
    let release,
        calls = 0,
        savingError = false;
    const snapshots = [];
    const flush = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: (snapshot) => {
            snapshots.push(snapshot);
            calls++;
            if (calls === 1)
                return new Promise((resolve) => {
                    release = resolve;
                });
            return Promise.resolve(null);
        },
    });
    const first = flush();
    const newer = { ...initial(), reviewCount: 2 };
    pending.current.set("a", newer);
    const second = flush();
    assert.equal(calls, 1);
    release(null);
    await Promise.all([first, second]);
    assert.equal(calls, 2);
    assert.equal(snapshots[1][0], newer);
    assert.equal(pending.current.size, 0);
    assert.equal(inFlight.current, null);
    const failing = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: () => Promise.reject(new Error("offline")),
    });
    pending.current.set("a", newer);
    await failing();
    assert.equal(pending.current.get("a"), newer);
    assert.equal(savingError, true);
    assert.equal(inFlight.current, null);
});
