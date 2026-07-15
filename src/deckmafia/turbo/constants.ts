// Turbo Mafia game constants

export const TURBO_GUILD_ID = "1012603013803814963";

export const CARD_NAMES = {
  ACTIVITY_COP: "Activity Cop",
  BABYSITTER: "Babysitter",
  VICTIM: "Victim",
  DEATH_CURSE: "Death Curse",
  FACTIONAL_KILL: "Factional Kill",
} as const;

export const ALIGNMENTS = {
  SUBVER: "Subver",
  SIREN: "Scarlet Siren",
} as const;

export const SIREN_ROLES = {
  INEX: "Inex",
  BOMBEY: "Bombey",
  ISIS: "Isis",
} as const;

export const GAME_STATUS = {
  SETUP: "SETUP",
  DAY: "DAY",
  NIGHT: "NIGHT",
  ENDED: "ENDED",
} as const;

/**
 * Returns the number of Sirens and their role assignments based on player count thresholds.
 *  7-8 players → 1 Siren (Inex)
 *  9-12 players → 2 Sirens (Inex, Bombey)
 *  13+ players → 3 Sirens (Inex, Bombey, Isis)
 */
export function getSirenConfig(playerCount: number): {
  sirenCount: number;
  sirenRoles: string[];
} {
  if (playerCount >= 13) {
    return { sirenCount: 3, sirenRoles: [SIREN_ROLES.INEX, SIREN_ROLES.BOMBEY, SIREN_ROLES.ISIS] };
  }
  if (playerCount >= 9) {
    return { sirenCount: 2, sirenRoles: [SIREN_ROLES.INEX, SIREN_ROLES.BOMBEY] };
  }
  // Minimum 7 players
  return { sirenCount: 1, sirenRoles: [SIREN_ROLES.INEX] };
}