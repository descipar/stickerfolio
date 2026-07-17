import { buildCatalog, expandNumberSpec, type CatalogSection } from "../lib/catalog";

const teamDefinitions: Array<[string, string]> = [
  ["MEX", "Mexiko"], ["RSA", "Südafrika"], ["KOR", "Südkorea"], ["CZE", "Tschechien"],
  ["CAN", "Kanada"], ["BIH", "Bosnien und Herzegowina"], ["QAT", "Katar"], ["SUI", "Schweiz"],
  ["BRA", "Brasilien"], ["MAR", "Marokko"], ["HAI", "Haiti"], ["SCO", "Schottland"],
  ["USA", "USA"], ["PAR", "Paraguay"], ["AUS", "Australien"], ["TUR", "Türkei"],
  ["GER", "Deutschland"], ["CUW", "Curaçao"], ["CIV", "Elfenbeinküste"], ["ECU", "Ecuador"],
  ["NED", "Niederlande"], ["JPN", "Japan"], ["SWE", "Schweden"], ["TUN", "Tunesien"],
  ["BEL", "Belgien"], ["EGY", "Ägypten"], ["IRN", "Iran"], ["NZL", "Neuseeland"],
  ["ESP", "Spanien"], ["CPV", "Kap Verde"], ["KSA", "Saudi-Arabien"], ["URU", "Uruguay"],
  ["FRA", "Frankreich"], ["SEN", "Senegal"], ["IRQ", "Irak"], ["NOR", "Norwegen"],
  ["ARG", "Argentinien"], ["ALG", "Algerien"], ["AUT", "Österreich"], ["JOR", "Jordanien"],
  ["POR", "Portugal"], ["COD", "DR Kongo"], ["UZB", "Usbekistan"], ["COL", "Kolumbien"],
  ["ENG", "England"], ["CRO", "Kroatien"], ["GHA", "Ghana"], ["PAN", "Panama"],
];

export const wm2026Sections: CatalogSection[] = [
  ...teamDefinitions.map(([code, name]) => ({
    code,
    name,
    stickerNumbers: Array.from({ length: 20 }, (_, index) => index + 1),
  })),
  { code: "FWC", name: "FIFA World Cup", stickerNumbers: Array.from({ length: 20 }, (_, index) => index), numberWidth: 2 },
  { code: "CC", name: "Coca-Cola", stickerNumbers: Array.from({ length: 14 }, (_, index) => index + 1) },
];

export const wm2026Catalog = buildCatalog(wm2026Sections);

const missingSpecs: Record<string, string> = {
  MEX: "5,7-8,12-13", RSA: "5-6,9-10,12,16-17", KOR: "4,8,12,14,16,18-19", CZE: "1-11,13-16,18-20",
  CAN: "6,17", BIH: "2,5-9,11,14,18,20", QAT: "9-10,15,17-18", SUI: "4,8-10,18,20",
  BRA: "3,7,9,16,18", MAR: "1-3,6,10-11,17,19", HAI: "3-5,13,15,20", SCO: "4-5,8,11,14,16",
  USA: "5,7,10,16-19", PAR: "3,10,14-15,20", AUS: "4,6-7,9-10,14,17-19", TUR: "1-10,13-20",
  GER: "12,18-20", CUW: "1,10,14", CIV: "2,6,13,15,17,19", ECU: "3-6,9,13,16,20",
  NED: "4,8,10,12,18", JPN: "7-8,10,14,20", SWE: "1-4,7-8,10-14,16-20", TUN: "4-5,7,9-10,14,16",
  BEL: "2,4-5,11,13,15", EGY: "4-5,10,13,16,18,20", IRN: "8,12-13,15,19", NZL: "5,7,12",
  ESP: "1,4-5,10-12,14,18", CPV: "12,19", KSA: "4-5,8,11,15,19", URU: "4-5,9,12,16-18,20",
  FRA: "2-3,6-7,9,15,18,20", SEN: "4-5,8,10-12,16-17", IRQ: "2-4,6-7,11-12,15,18,20", NOR: "1,6,8,10,14,17,20",
  ARG: "4,8,10-11,18", ALG: "1-2,19-20", AUT: "6,10-11,13,17-19", JOR: "5-6,16-18,20",
  POR: "14-17", COD: "4-6,8,10,12,17,19", UZB: "3,6-8,11-13,17,19", COL: "1,3-4,6,9,11,13",
  ENG: "2-3,11-13,16,20", CRO: "4-5,11,13-14,16-18", GHA: "5,8-9,11,13", PAN: "2-3,11-12,14",
  FWC: "0,9-10,12-13,18", CC: "2-3,5,9,12-14",
};

const duplicateSpecs: Record<string, string> = {
  ALG: "3-5", ARG: "6-7,9,13,17,19", AUS: "2-3,8", AUT: "1,3,12,15-16",
  BEL: "6-8,20", BRA: "10,20", CAN: "2,4,9", CIV: "1,4-5,18,20",
  COL: "12,19", CPV: "2,4", CRO: "1-2,15,19", CUW: "6-8,18-20",
  ECU: "15", EGY: "11", ESP: "6-7", FRA: "8,10-11,19", FWC: "19", GER: "1,11",
  GHA: "1,12,17-18,20", HAI: "1,10,14,18", IRN: "1,6,14", JOR: "1,3,11-12",
  JPN: "2,4,9", KSA: "1,6,17", MAR: "7,9,13-14", MEX: "10-11,15",
  NED: "11,13,17,20", NOR: "19", NZL: "19", PAN: "6,18-19", PAR: "5,12",
  POR: "4,8,13,19", QAT: "1,12,19", RSA: "4,18", SCO: "9", SEN: "6,13,20",
  SUI: "1,13,16", TUN: "11", URU: "6-7,10,15", USA: "6,8,15", UZB: "5,10,15-16",
};

const doubleDuplicateCodes = new Set(["ALG3", "AUT12", "GHA20", "MEX10", "POR13", "SEN20", "UZB5"]);

function codesFromSpecs(specs: Record<string, string>): Set<string> {
  const codes = new Set<string>();
  for (const [prefix, spec] of Object.entries(specs)) {
    for (const number of expandNumberSpec(spec)) {
      const formatted = prefix === "FWC" ? String(number).padStart(2, "0") : String(number);
      codes.add(`${prefix}${formatted}`);
    }
  }
  return codes;
}

export const wm2026MissingCodes = codesFromSpecs(missingSpecs);
export const wm2026DuplicateCodes = codesFromSpecs(duplicateSpecs);

export function initialWm2026Quantity(code: string): number {
  if (wm2026MissingCodes.has(code)) return 0;
  if (doubleDuplicateCodes.has(code)) return 3;
  if (wm2026DuplicateCodes.has(code)) return 2;
  return 1;
}
