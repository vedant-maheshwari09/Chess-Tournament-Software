import React from "react";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SwissPlayerStanding, PlayerRoundResult } from "./types";

interface StandingsTableProps {
  standings: SwissPlayerStanding[];
  totalRounds: number;
  activeTiebreakRules: string[];
  tournamentConfig: any;
  getPlayerPairingNumber: (playerId: number) => number;
  renderRoundOutcomeBadge: (res: PlayerRoundResult) => React.ReactNode;
  formatPoints: (standing: SwissPlayerStanding) => string;
}

export function StandingsTable({
  standings,
  totalRounds,
  activeTiebreakRules,
  tournamentConfig,
  getPlayerPairingNumber,
  renderRoundOutcomeBadge,
  formatPoints,
}: StandingsTableProps) {
  const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';

  return (
    <div className="overflow-x-auto border border-black p-1 bg-white">
      <table className="w-full border-collapse" style={{ borderCollapse: 'collapse', border: '1px solid black', width: '100%', fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#000', backgroundColor: '#fff' }}>
        <thead>
          <tr style={{ border: '1px solid black', backgroundColor: '#e8e8e8' }}>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '48px' }}>
              #
            </th>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'left' }}>
              Name/Rating/ID
            </th>
            {Array.from({ length: totalRounds }, (_, i) => (
              <th key={i} className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '64px' }}>
                Rd {i + 1}
              </th>
            ))}
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '80px' }}>
              Total
            </th>
            {activeTiebreakRules.map((rule) => (
              <th key={rule} className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '80px' }}>
                {rule}
              </th>
            ))}
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '80px' }}>
              Est. Post
            </th>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', width: '80px' }}>
              Prize
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing) => {
            const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated';
            const lastName = standing.player.lastName || '';
            const firstName = standing.player.firstName || '';
            const nameStr = lastName && firstName ? lastName + ", " + firstName : (firstName + " " + lastName).trim();
            const uscfId = standing.player.localId;
            const isDigitsOnly = !!(uscfId && /^\d+$/.test(uscfId));
            const isWithdrawn = standing.player.status === 'withdrawn' || standing.isWithdrawn;
            const pairingNum = getPlayerPairingNumber(standing.player.id);

            return (
              <tr key={standing.player.id} style={{ border: '1px solid black', height: '40px', backgroundColor: isWithdrawn ? '#f1f5f9' : '#fff' }}>
                <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>
                  {standing.position}
                </td>
                <td style={{ border: '1px solid black', padding: '6px 8px' }}>
                  <div className="font-bold flex items-center justify-between">
                    <span>
                      {pairingNum}. {nameStr}
                    </span>
                    {isWithdrawn && (
                      <Badge variant="secondary" className="ml-2 text-[10px] font-sans scale-90 border-slate-300 text-slate-650 bg-slate-100">
                        WD
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 font-sans flex items-center gap-1.5 leading-none mt-0.5">
                    <span>Rtg: {playerRating}</span>
                    {uscfId && (
                      <>
                        <span>•</span>
                        <span>ID: {uscfId}</span>
                      </>
                    )}
                  </div>
                </td>
                {standing.roundResults.map((res, roundIdx) => (
                  <td key={roundIdx} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                    {renderRoundOutcomeBadge(res)}
                  </td>
                ))}
                <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px' }}>
                  {formatPoints(standing)}
                </td>
                {activeTiebreakRules.map((rule) => {
                  const val = standing.tiebreakValues[rule];
                  return (
                    <td key={rule} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                      {typeof val === 'number' ? val.toFixed(1).replace(/\.0$/, "") : '0'}
                    </td>
                  );
                })}
                <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', color: '#1e293b' }}>
                  {isWithdrawn ? '---' : standing.postRating || playerRating}
                </td>
                <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', color: '#15803d' }}>
                  {standing.prizeAmount ? "$" + standing.prizeAmount : '---'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
