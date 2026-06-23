import type { Express } from "express";
import { applyTournamentsRoutes as apply } from "./tournaments/index";

export function applyTournamentsRoutes(app: Express) {
  apply(app);
}
