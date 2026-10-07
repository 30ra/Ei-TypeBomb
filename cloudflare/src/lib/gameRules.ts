import type { GameRules } from '../../../server/src/shared/game';

// Preserve the Worker's existing start/countdown/stop behavior.
export const WORKER_GAME_RULES: GameRules = {
	allowSpectatorStart: false,
	allowCountdownPass: false,
	clearInputOnStop: true,
};
