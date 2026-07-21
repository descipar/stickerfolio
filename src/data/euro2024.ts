import { deterministicUuid } from "@/modules/catalog/deterministic-id";
import type { AlbumTemplate } from "@/modules/catalog";

// The standard German edition is modeled by physical carrier sheet because that
// is the unit collectors own and trade. Combined codes represent two smaller
// stickers supplied on one carrier sheet. Parallel variants are alternatives
// for an album position and are intentionally not separate completion items.
const namespace = "157fd756-d7b2-5cef-a0a0-f16c8d78d671";

interface TeamSource {
  code: string;
  name: string;
  kind: "full" | "playoff";
}

interface GroupSource {
  code: string;
  name: string;
  teams: TeamSource[];
}

const groups: GroupSource[] = [
  {
    code: "GA",
    name: "Group A",
    teams: [
      { code: "GER", name: "Germany", kind: "full" },
      { code: "SCO", name: "Scotland", kind: "full" },
      { code: "HUN", name: "Hungary", kind: "full" },
      { code: "SUI", name: "Switzerland", kind: "full" },
    ],
  },
  {
    code: "GB",
    name: "Group B",
    teams: [
      { code: "ESP", name: "Spain", kind: "full" },
      { code: "CRO", name: "Croatia", kind: "full" },
      { code: "ITA", name: "Italy", kind: "full" },
      { code: "ALB", name: "Albania", kind: "full" },
    ],
  },
  {
    code: "GC",
    name: "Group C",
    teams: [
      { code: "SVN", name: "Slovenia", kind: "full" },
      { code: "DEN", name: "Denmark", kind: "full" },
      { code: "SRB", name: "Serbia", kind: "full" },
      { code: "ENG", name: "England", kind: "full" },
    ],
  },
  {
    code: "GD",
    name: "Group D",
    teams: [
      { code: "POL", name: "Poland", kind: "playoff" },
      { code: "EST", name: "Estonia", kind: "playoff" },
      { code: "WAL", name: "Wales", kind: "playoff" },
      { code: "FIN", name: "Finland", kind: "playoff" },
      { code: "NED", name: "Netherlands", kind: "full" },
      { code: "AUT", name: "Austria", kind: "full" },
      { code: "FRA", name: "France", kind: "full" },
    ],
  },
  {
    code: "GE",
    name: "Group E",
    teams: [
      { code: "BEL", name: "Belgium", kind: "full" },
      { code: "SVK", name: "Slovakia", kind: "full" },
      { code: "ROM", name: "Romania", kind: "full" },
      { code: "ISR", name: "Israel", kind: "playoff" },
      { code: "ICE", name: "Iceland", kind: "playoff" },
      { code: "BIH", name: "Bosnia and Herzegovina", kind: "playoff" },
      { code: "UKR", name: "Ukraine", kind: "playoff" },
    ],
  },
  {
    code: "GF",
    name: "Group F",
    teams: [
      { code: "TUR", name: "Türkiye", kind: "full" },
      { code: "GEO", name: "Georgia", kind: "playoff" },
      { code: "LUX", name: "Luxembourg", kind: "playoff" },
      { code: "GRE", name: "Greece", kind: "playoff" },
      { code: "KAZ", name: "Kazakhstan", kind: "playoff" },
      { code: "POR", name: "Portugal", kind: "full" },
      { code: "CZE", name: "Czechia", kind: "full" },
    ],
  },
];

interface SourceSection {
  code: string;
  name: string;
  stickerCodes: string[];
}

const fullTeamCodes = (team: string): string[] => [
  `${team}P1`,
  `${team}P2`,
  `${team}PTW`,
  `${team}SP`,
  `${team}TOP1`,
  `${team}TOP2`,
  ...Array.from({ length: 21 }, (_, index) => `${team}${index + 1}`),
];

const playoffTeamCodes = (team: string): string[] => [
  `${team}SP`,
  `${team}1`,
  ...Array.from({ length: 7 }, (_, index) => {
    const first = index * 2 + 2;
    return `${team}${first}+${first + 1}`;
  }),
];

const sourceSections: SourceSection[] = [
  { code: "INTRO", name: "Tournament", stickerCodes: ["TOPPS1", "UEFA1", "UEFA2", "UEFA3"] },
  {
    code: "EURO",
    name: "Host cities",
    stickerCodes: Array.from({ length: 11 }, (_, index) => `EURO${index + 1}`),
  },
];

for (const group of groups) {
  sourceSections.push({ code: group.code, name: group.name, stickerCodes: [`${group.code}1+2`] });
  for (const team of group.teams) {
    sourceSections.push({
      code: team.code,
      name: team.name,
      stickerCodes: team.kind === "full" ? fullTeamCodes(team.code) : playoffTeamCodes(team.code),
    });
  }
  if (group.code === "GC") {
    sourceSections.push({ code: "MM", name: "Dream Team", stickerCodes: ["MM1+2"] });
  }
}

sourceSections.push({
  code: "LEG",
  name: "Legends",
  stickerCodes: Array.from({ length: 10 }, (_, index) => `LEG${index + 1}`),
});

export const euro2024AlbumId = deterministicUuid(namespace, "album:topps-euro-2024");
export const euro2024RevisionId = deterministicUuid(namespace, "album:topps-euro-2024:revision:1");

const sections = sourceSections.map((section, index) => ({
  id: deterministicUuid(namespace, `album:topps-euro-2024:revision:1:section:${section.code}`),
  code: section.code,
  name: section.name,
  sortOrder: index,
}));

const sectionIds = new Map(sections.map((section) => [section.code, section.id]));
let stickerSortOrder = 0;
const stickers = sourceSections.flatMap((section) =>
  section.stickerCodes.map((code) => ({
    stableId: deterministicUuid(namespace, `album:topps-euro-2024:sticker:${code}`),
    stableKey: code.toLowerCase(),
    sectionId: sectionIds.get(section.code)!,
    code,
    label: code,
    sortOrder: stickerSortOrder++,
  })),
);

export const euro2024Template: AlbumTemplate = {
  formatVersion: 1,
  album: {
    id: euro2024AlbumId,
    slug: "topps-uefa-euro-2024-standard-de",
    title: "Topps UEFA EURO 2024",
    description: "Standard German edition · 707 physical sticker carriers · parallel variants excluded",
  },
  revision: {
    id: euro2024RevisionId,
    number: 1,
    label: "Standard German edition",
    status: "published",
  },
  sections,
  stickers,
};
