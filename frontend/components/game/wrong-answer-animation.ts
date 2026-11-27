import type { AnimationEvent } from "react";

export function playWrongAnswerAnimation(element: HTMLDivElement | null) {
    if (!element) return;

    // Rewind an in-flight shake so consecutive errors each give feedback.
    const animations = element.getAnimations();
    if (
        animations.length > 0 &&
        element.classList.contains("wrong-answer")
    ) {
        animations.forEach((animation) => {
            animation.currentTime = 0;
        });
    } else {
        element.classList.remove("wrong-answer");
        // Restart the animation when a previous run has already finished.
        void element.offsetWidth;
        element.classList.add("wrong-answer");
    }
}

export function clearWrongAnswerAnimation(event: AnimationEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && event.animationName === "wrongAnswer") {
        event.currentTarget.classList.remove("wrong-answer");
    }
}
