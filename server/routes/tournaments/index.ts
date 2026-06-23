import type { Express } from "express";
import { applyGeneralRoutes } from "./general";
import { applyCoreRoutes } from "./core";
import { applyRegistrationsRoutes } from "./registrations";
import { applyPlayersRoutes } from "./players";
import { applyPairingsRoutes } from "./pairings";
import { applyMatchesRoutes } from "./matches";
import { applyReportsRoutes } from "./reports";

export function applyTournamentsRoutes(app: Express) {
  applyGeneralRoutes(app);
  applyCoreRoutes(app);
  applyRegistrationsRoutes(app);
  applyPlayersRoutes(app);
  applyPairingsRoutes(app);
  applyMatchesRoutes(app);
  applyReportsRoutes(app);
}
