import type { Tournament, Player, Match, Pairing } from "@shared/schema";
import type { TournamentConfig } from "@shared/tournament-config";
import { parseTournamentConfig } from "@shared/tournament-config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// dBase III DBF binary writer
class DbfWriter {
  private fields: { name: string; type: 'C' | 'D' | 'N'; length: number }[] = [];
  private records: Record<string, string>[] = [];

  addField(name: string, type: 'C' | 'D' | 'N', length: number) {
    this.fields.push({ name, type, length });
  }

  addRecord(record: Record<string, string>) {
    this.records.push(record);
  }

  build(): Buffer {
    const recordLength = 1 + this.fields.reduce((acc, f) => acc + f.length, 0);
    const headerLength = 32 + this.fields.length * 32 + 1;
    
    // Allocate buffer
    const totalSize = headerLength + this.records.length * recordLength + 1;
    const buf = Buffer.alloc(totalSize);

    // 1. Write Header (32 bytes)
    buf.writeUInt8(0x03, 0); // Version (dBase III without memo)
    
    const now = new Date();
    buf.writeUInt8(now.getFullYear() - 2000, 1);
    buf.writeUInt8(now.getMonth() + 1, 2);
    buf.writeUInt8(now.getDate(), 3);

    buf.writeUInt32LE(this.records.length, 4); // Number of records
    buf.writeUInt16LE(headerLength, 8); // Header length
    buf.writeUInt16LE(recordLength, 10); // Record length

    // 2. Write Field Descriptors (32 bytes each)
    let offset = 32;
    for (const field of this.fields) {
      // Field Name (11 bytes, null-padded)
      const nameBuf = Buffer.alloc(11);
      nameBuf.write(field.name, 0, 'ascii');
      nameBuf.copy(buf, offset);

      // Field Type (1 byte)
      buf.write(field.type, offset + 11, 'ascii');

      // Field Length (1 byte)
      buf.writeUInt8(field.length, offset + 16);

      offset += 32;
    }

    // 3. Header Terminator
    buf.writeUInt8(0x0D, offset);
    offset += 1;

    // 4. Write Records
    for (const record of this.records) {
      // Delete flag: space (0x20) means active
      buf.writeUInt8(0x20, offset); 
      let recOffset = 1;

      for (const field of this.fields) {
        const val = record[field.name] !== undefined ? String(record[field.name]) : "";
        const valBuf = Buffer.alloc(field.length, ' '); // space filled
        valBuf.write(val.substring(0, field.length), 0, 'ascii');
        valBuf.copy(buf, offset + recOffset);
        recOffset += field.length;
      }
      offset += recordLength;
    }

    // 5. EOF Terminator
    buf.writeUInt8(0x1A, offset);

    return buf;
  }
}

interface GenerateUscfDbfOptions {
  tournament: Tournament;
  config: TournamentConfig;
  players: Player[];
  matches: Match[];
  pairings: Pairing[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const cleaned = dateStr.trim();
  if (/^\d{8}$/.test(cleaned)) return cleaned;
  
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return "";
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function generateUscfDbfZip(options: GenerateUscfDbfOptions): Buffer {
  const { tournament, config, players, matches, pairings } = options;

  // 1. Generate THEXPORT.DBF
  const th = new DbfWriter();
  th.addField("H_FORMAT", "C", 5);
  th.addField("H_PROGRAM", "C", 10);
  th.addField("H_EVENT_ID", "C", 12);
  th.addField("H_NAME", "C", 35);
  th.addField("H_TOT_SECT", "C", 2);
  th.addField("H_BEG_DATE", "D", 8);
  th.addField("H_END_DATE", "D", 8);
  th.addField("H_AFF_ID", "C", 8);
  th.addField("H_CITY", "C", 21);
  th.addField("H_STATE", "C", 2);
  th.addField("H_ZIPCODE", "C", 10);
  th.addField("H_COUNTRY", "C", 21);
  th.addField("H_SENDCROS", "C", 1);
  th.addField("H_CTD_ID", "C", 8);
  th.addField("H_ATD_ID", "C", 8);
  th.addField("H_OTHER_TD", "C", 255);

  const eventId = formatDate(config.basic.startDate || tournament.createdAt?.toISOString()).substring(0, 8) + 
                  String(tournament.id).padStart(4, '0').substring(0, 4);

  // Group players by section to find how many sections exist
  const playersBySection = players.reduce((acc, p) => {
    const key = p.sectionId || "default";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, Player[]>);

  const sectionKeys = Object.keys(playersBySection);
  const totalSections = Math.max(1, sectionKeys.length);

  const chiefTdId = (
    (config.uscf as any).chiefTdId ||
    config.uscf.tournamentDirector ||
    config.details.chiefArbiter ||
    ""
  ).replace(/[^0-9]/g, "").substring(0, 8);

  const assistantTdId = (
    (config.uscf as any).assistantTdId ||
    config.uscf.assistantDirector ||
    ""
  ).replace(/[^0-9]/g, "").substring(0, 8);

  const otherTds = (
    config.uscf.assistants ||
    (config.details.assistantTDs && config.details.assistantTDs.join(", ")) ||
    ""
  ).substring(0, 255);

  const affiliateId = (config.uscf.affiliateId || config.details.affiliate || "").trim().substring(0, 8);
  const eventName = (config.basic.name || tournament.name || "").substring(0, 35);
  const city = (config.basic.city || tournament.location || "City").substring(0, 21);
  const state = (config.uscf.state || config.basic.state || "CA").substring(0, 2).toUpperCase();
  const sendCros = config.uscf.sendCrossTableTo === "affiliate" ? "A" : (config.uscf.sendCrossTableTo === "tournament_director" ? "T" : "N");

  th.addRecord({
    H_FORMAT: "2C",
    H_PROGRAM: "ChessMgr",
    H_EVENT_ID: eventId,
    H_NAME: eventName,
    H_TOT_SECT: String(totalSections).padEnd(2),
    H_BEG_DATE: formatDate(config.basic.startDate),
    H_END_DATE: formatDate(config.basic.endDate),
    H_AFF_ID: affiliateId,
    H_CITY: city,
    H_STATE: state,
    H_ZIPCODE: "",
    H_COUNTRY: "USA",
    H_SENDCROS: sendCros,
    H_CTD_ID: chiefTdId,
    H_ATD_ID: assistantTdId,
    H_OTHER_TD: otherTds
  });

  // 2. Generate TSEXPORT.DBF & TDEXPORT.DBF
  const ts = new DbfWriter();
  ts.addField("S_EVENT_ID", "C", 12);
  ts.addField("S_SEC_NUM", "C", 2);
  ts.addField("S_SEC_NAME", "C", 30);
  ts.addField("S_R_SYSTEM", "C", 1);
  ts.addField("S_TIMECTL", "C", 40);
  ts.addField("S_CTD_ID", "C", 8);
  ts.addField("S_ATD_ID", "C", 8);
  ts.addField("S_TRN_TYPE", "C", 1);
  ts.addField("S_TOT_RNDS", "C", 2);
  ts.addField("S_LST_PAIR", "C", 4);
  ts.addField("S_BEG_DATE", "D", 8);
  ts.addField("S_END_DATE", "D", 8);
  ts.addField("S_SCH_LVL", "C", 1);
  ts.addField("S_GR_PRIX", "C", 1);
  ts.addField("S_GP_PTS", "C", 3);
  ts.addField("S_FIDE", "C", 1);

  // We need to count maximum rounds across all sections to declare result fields in TDEXPORT.
  let maxRoundsInSection = 1;
  const sectionRoundsMap = new Map<string, number>();

  sectionKeys.forEach((secKey, index) => {
    const secPlayers = playersBySection[secKey] || [];
    const secPlayerIds = new Set(secPlayers.map(p => p.id));
    const secMatches = matches.filter(m => m.whitePlayerId && secPlayerIds.has(m.whitePlayerId) || m.blackPlayerId && secPlayerIds.has(m.blackPlayerId));
    const secPairings = pairings.filter(p => secPlayerIds.has(p.playerId));

    // Determine total rounds
    const maxMatchRound = secMatches.reduce((max, m) => Math.max(max, m.round ?? 0), 0);
    const maxPairingRound = secPairings.reduce((max, p) => Math.max(max, p.round ?? 0), 0);
    const numRounds = Math.max(config.details.rounds || 0, maxMatchRound, maxPairingRound, 1);
    sectionRoundsMap.set(secKey, numRounds);
    if (numRounds > maxRoundsInSection) {
      maxRoundsInSection = numRounds;
    }
  });

  const td = new DbfWriter();
  td.addField("D_EVENT_ID", "C", 12);
  td.addField("D_SEC_NUM", "C", 2);
  td.addField("D_PAIR_NUM", "C", 4);
  td.addField("D_MEM_ID", "C", 8);
  td.addField("D_NAME", "C", 30);
  td.addField("D_STATE", "C", 2);
  td.addField("D_RATING", "C", 4);
  
  for (let r = 1; r <= maxRoundsInSection; r++) {
    td.addField(`D_RND${String(r).padStart(2, '0')}`, "C", 7);
  }

  sectionKeys.forEach((secKey, index) => {
    const secNum = String(index + 1).padEnd(2);
    const secPlayers = playersBySection[secKey] || [];
    const numRounds = sectionRoundsMap.get(secKey) || 1;

    // Seeding/Sorting players to assign pairing numbers
    const sortedSecPlayers = [...secPlayers].sort((a, b) => {
      if (typeof a.seed === "number" && typeof b.seed === "number") return a.seed - b.seed;
      if (typeof a.seed === "number") return -1;
      if (typeof b.seed === "number") return 1;
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDiff !== 0) return ratingDiff;
      return a.lastName.localeCompare(b.lastName);
    });

    const pairingNumMap = new Map<number, number>();
    sortedSecPlayers.forEach((p, idx) => {
      pairingNumMap.set(p.id, idx + 1);
    });

    // Add Section Record
    const sectionName = (secPlayers[0]?.sectionName || (secKey === 'default' ? 'Open' : secKey)).substring(0, 30);
    const ratingSystem = config.details.timeControl === 'blitz' ? 'Q' : (config.details.timeControl === 'rapid' ? 'D' : 'R');
    const timeControlStr = (config.uscf.timeControl || `${config.details.timeControls[0]?.minutes || 90}/inc${config.details.timeControls[0]?.addonValue || 30}`).substring(0, 40);
    const trnType = tournament.format === 'roundrobin' ? 'R' : 'S';
    const scholastic = config.uscf.scholastic ? 'S' : 'N';
    const hasGp = Number(config.uscf.grandPrixPoints) > 0 ? 'G' : 'N';
    const gpPoints = String(config.uscf.grandPrixPoints || '0').padEnd(3);
    const fideRated = config.registers.fideRated ? 'Y' : 'N';

    ts.addRecord({
      S_EVENT_ID: eventId,
      S_SEC_NUM: secNum,
      S_SEC_NAME: sectionName,
      S_R_SYSTEM: ratingSystem,
      S_TIMECTL: timeControlStr,
      S_CTD_ID: chiefTdId,
      S_ATD_ID: assistantTdId,
      S_TRN_TYPE: trnType,
      S_TOT_RNDS: String(numRounds).padEnd(2),
      S_LST_PAIR: String(sortedSecPlayers.length).padEnd(4),
      S_BEG_DATE: formatDate(config.basic.startDate),
      S_END_DATE: formatDate(config.basic.endDate),
      S_SCH_LVL: scholastic,
      S_GR_PRIX: hasGp,
      S_GP_PTS: gpPoints,
      S_FIDE: fideRated
    });

    // Add Player Detail Records
    sortedSecPlayers.forEach((player) => {
      const pairNum = pairingNumMap.get(player.id) || 1;
      const memId = (player.localId || "00000000").replace(/[^0-9]/g, "").padEnd(8).substring(0, 8);
      const name = `${player.lastName.toUpperCase()}, ${player.firstName.toUpperCase()}`.substring(0, 30);
      const playerRating = String(player.uscfRating || player.rating || 0).substring(0, 4);

      const record: Record<string, string> = {
        D_EVENT_ID: eventId,
        D_SEC_NUM: secNum,
        D_PAIR_NUM: String(pairNum).padEnd(4),
        D_MEM_ID: memId,
        D_NAME: name,
        D_STATE: state,
        D_RATING: playerRating
      };

      // Populate round results
      for (let r = 1; r <= maxRoundsInSection; r++) {
        const roundFieldName = `D_RND${String(r).padStart(2, '0')}`;
        
        if (r > numRounds) {
          record[roundFieldName] = "U0000  "; // Padding for extra rounds
          continue;
        }

        // Find match for this player in this round
        const match = matches.find(m => m.round === r && (m.whitePlayerId === player.id || m.blackPlayerId === player.id));
        if (!match) {
          // Check if there was a bye pairing
          const bye = pairings.find(p => p.round === r && p.playerId === player.id && p.isBye);
          if (bye) {
            const code = bye.byeType === 'half_point' ? 'H' : (bye.byeType === 'full_point' ? 'B' : 'U');
            record[roundFieldName] = `${code}0000  `;
          } else {
            record[roundFieldName] = "U0000  "; // Unplayed
          }
          continue;
        }

        if (match.isBye) {
          const res = match.result;
          let code = 'U';
          if (res === '1-0' || res === '1-bye' || res === '1-byeU' || res === '1-0U') {
            code = 'B';
          } else if (res === '1/2-1/2' || res === '1/2-bye' || res === '1/2-byeU' || res === '1/2-1/2U') {
            code = 'H';
          }
          record[roundFieldName] = `${code}0000  `;
          continue;
        }

        // Find opponent
        const isWhite = match.whitePlayerId === player.id;
        const opponentId = isWhite ? match.blackPlayerId : match.whitePlayerId;
        const opponentPairNum = opponentId ? pairingNumMap.get(opponentId) || 0 : 0;
        const oppNumStr = String(opponentPairNum).padStart(4, ' ');

        const colorChar = isWhite ? 'W' : 'B';
        let resultChar = 'U';

        if (match.result === '1-0') {
          resultChar = isWhite ? 'W' : 'L';
        } else if (match.result === '0-1') {
          resultChar = isWhite ? 'L' : 'W';
        } else if (match.result === '1/2-1/2') {
          resultChar = 'D';
        } else if (match.result === '1F-0F') {
          resultChar = isWhite ? 'X' : 'F';
        } else if (match.result === '0F-1F') {
          resultChar = isWhite ? 'F' : 'X';
        } else if (match.result === '0F-0F') {
          resultChar = 'Z';
        }

        record[roundFieldName] = `${resultChar}${oppNumStr}${colorChar} `;
      }

      td.addRecord(record);
    });
  });

  const thBuffer = th.build();
  const tsBuffer = ts.build();
  const tdBuffer = td.build();

  // Create zip file using PowerShell on Windows
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uscf-dbf-'));
  
  const thPath = path.join(tempDir, 'THEXPORT.DBF');
  const tsPath = path.join(tempDir, 'TSEXPORT.DBF');
  const tdPath = path.join(tempDir, 'TDEXPORT.DBF');

  fs.writeFileSync(thPath, thBuffer);
  fs.writeFileSync(tsPath, tsBuffer);
  fs.writeFileSync(tdPath, tdBuffer);

  const zipPath = path.join(tempDir, 'uscf-export.zip');

  try {
    // Compress files using PowerShell
    const cmd = `powershell.exe -Command "Compress-Archive -Path '${tempDir}\\*EXPORT.DBF' -DestinationPath '${zipPath}' -Force"`;
    execSync(cmd, { stdio: 'ignore' });
    
    const zipBuffer = fs.readFileSync(zipPath);

    // Cleanup files
    fs.unlinkSync(thPath);
    fs.unlinkSync(tsPath);
    fs.unlinkSync(tdPath);
    fs.unlinkSync(zipPath);
    fs.rmdirSync(tempDir);

    return zipBuffer;
  } catch (error) {
    console.error("Failed to generate USCF zip archive via PowerShell:", error);
    // Cleanup on error
    try {
      fs.unlinkSync(thPath);
      fs.unlinkSync(tsPath);
      fs.unlinkSync(tdPath);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      fs.rmdirSync(tempDir);
    } catch {}
    throw new Error("PowerShell ZIP compression failed.");
  }
}
