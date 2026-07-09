import React from "react";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SwissPlayerStanding, PlayerRoundResult } from "./types";

interface StandingsTableProps {
  standings: SwissPlayerStanding[];
  totalRounds: number;
  currentRound: number;
  activeTiebreakRules: string[];
  tournamentConfig: any;
  getPlayerPairingNumber: (playerId: number) => number;
  renderRoundOutcomeBadge: (res: PlayerRoundResult) => React.ReactNode;
  formatPoints: (standing: SwissPlayerStanding) => string;
}

export function StandingsTable({
  standings,
  totalRounds,
  currentRound,
  activeTiebreakRules,
  tournamentConfig,
  getPlayerPairingNumber,
  renderRoundOutcomeBadge,
  formatPoints,
}: StandingsTableProps) {
  const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';

  return (
    <div className="overflow-x-auto border border-black p-1 bg-white">
      <table className="w-full border-collapse" style={{ borderCollapse: 'collapse', border: '1px solid black', width: '100%', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#000', backgroundColor: '#fff' }}>
        <thead>
          <tr style={{ border: '1px solid black', backgroundColor: '#e8e8e8' }}>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '48px' }}>
              #
            </th>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'left' }}>
              Name/Rating/ID
            </th>
            {Array.from({ length: totalRounds }, (_, i) => (
              <th key={i} className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '64px' }}>
                Rd {i + 1}
              </th>
            ))}
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '80px' }}>
              Total
            </th>
            {activeTiebreakRules.map((rule) => (
              <th key={rule} className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '80px' }}>
                {rule}
              </th>
            ))}
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '80px' }}>
              Perf.
            </th>
            <th className="font-sans" style={{ border: '1px solid black', padding: '6px 8px', color: '#000', backgroundColor: '#e8e8e8', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', width: '80px' }}>
              Est. Post
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing) => {
            const playerRating = (isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated';
            const lastName = standing.player.lastName || '';
            const firstName = standing.player.firstName || '';
            const nameStr = lastName && firstName ? lastName + ", " + firstName : (firstName + " " + lastName).trim();
            
            // Robust multi-field USCF ID fallback
            const uscfId = standing.player.localId || (standing.player as any).local_id || (standing.player as any).userUscfId || (standing.player as any).uscfId || (standing.player as any).uscf_id;
            
            const isWithdrawn = standing.player.status === 'withdrawn' || standing.isWithdrawn;

            return (
              <React.Fragment key={standing.player.id}>
                {/* Row 1: Position, Name, Round outcomes, Total, Tiebreaks, Performance, Est. Post */}
                <tr style={{ border: '1px solid black', height: '24px', backgroundColor: isWithdrawn ? '#f1f5f9' : '#fff' }}>
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>
                    {standing.position}
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', fontWeight: 'bold' }}>
                    <div className="flex items-center justify-between">
                      <span>{nameStr}</span>
                      {isWithdrawn && (
                        <Badge variant="secondary" className="ml-2 text-[10px] font-sans scale-90 border-slate-300 text-slate-650 bg-slate-100">
                          WD
                        </Badge>
                      )}
                    </div>
                  </td>
                  {standing.roundResults.map((res, roundIdx) => (
                    <td key={roundIdx} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                      {renderRoundOutcomeBadge(res)}
                    </td>
                  ))}
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px' }}>
                    {formatPoints(standing)}
                  </td>
                  {activeTiebreakRules.map((rule) => {
                    const val = standing.tiebreakValues[rule];
                    return (
                      <td key={rule} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontSize: '15px' }}>
                        {typeof val === 'number' ? val.toFixed(1).replace(/\.0$/, "") : '0'}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', color: '#1e293b', fontSize: '15px' }}>
                    {isWithdrawn ? '---' : standing.performanceRating || playerRating}
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', color: '#1e293b', fontSize: '15px' }}>
                    {isWithdrawn ? '---' : standing.postRating || playerRating}
                  </td>
                </tr>

                {/* Row 2: Empty Position, Rating & ID, Cumulative scores, Empty Total, Tiebreaks, Empty Performance, Est. Post */}
                <tr style={{ border: '1px solid black', height: '20px', backgroundColor: isWithdrawn ? '#f1f5f9' : '#fff' }}>
                  <td style={{ backgroundColor: '#e8e8e8', border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                    &nbsp;
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'left' }}>
                    <div className="text-[13px] text-gray-500 font-sans leading-none mt-1">
                      <span style={{ fontWeight: 'bold', color: '#000' }}>{playerRating}</span>{uscfId ? ` \u00a0\u00a0 ID: ${uscfId}` : ''}
                    </div>
                  </td>
                  {standing.roundResults.map((res, roundIdx) => {
                    const cumulative = standing.roundResults
                      .slice(0, roundIdx + 1)
                      .reduce((sum, entry) => sum + entry.points, 0);
                    
                    // Cumulative scores are only shown for unwithdrawn/active matches of past/current rounds
                    const showCumulative = roundIdx < currentRound && res.result && res.result !== 'unplayed' && !res.isInProgress && res.result !== 'withdrawn';
                    
                    return (
                      <td key={roundIdx} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center', fontSize: '13px', color: '#475569' }}>
                        {showCumulative ? cumulative.toFixed(1).replace(/\.0$/, "") : '\u00a0'}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                    &nbsp;
                  </td>
                  {activeTiebreakRules.map((rule) => (
                    <td key={rule} style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                      &nbsp;
                    </td>
                  ))}
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                    &nbsp;
                  </td>
                  <td style={{ border: '1px solid black', padding: '6px 8px', textAlign: 'center' }}>
                    &nbsp;
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
