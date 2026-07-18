import { deterministicUuid } from "@/modules/catalog/deterministic-id";
import type { AlbumTemplate } from "@/modules/catalog";

const namespace = "41bf5c3c-9e8e-5fc4-a7f2-dd7a78ed0747";

const teams: ReadonlyArray<readonly [string, string]> = [
  ["MEX", "Mexico"], ["RSA", "South Africa"], ["KOR", "South Korea"], ["CZE", "Czechia"],
  ["CAN", "Canada"], ["BIH", "Bosnia and Herzegovina"], ["QAT", "Qatar"], ["SUI", "Switzerland"],
  ["BRA", "Brazil"], ["MAR", "Morocco"], ["HAI", "Haiti"], ["SCO", "Scotland"],
  ["USA", "United States"], ["PAR", "Paraguay"], ["AUS", "Australia"], ["TUR", "Türkiye"],
  ["GER", "Germany"], ["CUW", "Curaçao"], ["CIV", "Côte d’Ivoire"], ["ECU", "Ecuador"],
  ["NED", "Netherlands"], ["JPN", "Japan"], ["SWE", "Sweden"], ["TUN", "Tunisia"],
  ["BEL", "Belgium"], ["EGY", "Egypt"], ["IRN", "Iran"], ["NZL", "New Zealand"],
  ["ESP", "Spain"], ["CPV", "Cabo Verde"], ["KSA", "Saudi Arabia"], ["URU", "Uruguay"],
  ["FRA", "France"], ["SEN", "Senegal"], ["IRQ", "Iraq"], ["NOR", "Norway"],
  ["ARG", "Argentina"], ["ALG", "Algeria"], ["AUT", "Austria"], ["JOR", "Jordan"],
  ["POR", "Portugal"], ["COD", "DR Congo"], ["UZB", "Uzbekistan"], ["COL", "Colombia"],
  ["ENG", "England"], ["CRO", "Croatia"], ["GHA", "Ghana"], ["PAN", "Panama"],
];

interface SourceSection {
  code: string;
  name: string;
  numbers: number[];
  width?: number;
}

const sourceSections: SourceSection[] = [
  ...teams.map(([code, name]) => ({ code, name, numbers: Array.from({ length: 20 }, (_, index) => index + 1) })),
  { code: "FWC", name: "FIFA World Cup", numbers: Array.from({ length: 20 }, (_, index) => index), width: 2 },
  { code: "CC", name: "Coca-Cola", numbers: Array.from({ length: 14 }, (_, index) => index + 1) },
];

export const wm2026AlbumId = deterministicUuid(namespace, "album:wm-2026");
export const wm2026RevisionId = deterministicUuid(namespace, "album:wm-2026:revision:1");

const sections = sourceSections.map((section, index) => ({
  id: deterministicUuid(namespace, `album:wm-2026:revision:1:section:${section.code}`),
  code: section.code,
  name: section.name,
  sortOrder: index,
}));

const sectionIds = new Map(sections.map((section) => [section.code, section.id]));
let stickerSortOrder = 0;
const stickers = sourceSections.flatMap((section) =>
  section.numbers.map((number) => {
    const formatted = section.width ? String(number).padStart(section.width, "0") : String(number);
    const code = `${section.code}${formatted}`;
    return {
      stableId: deterministicUuid(namespace, `album:wm-2026:sticker:${code}`),
      stableKey: code,
      sectionId: sectionIds.get(section.code)!,
      code,
      label: code,
      sortOrder: stickerSortOrder++,
    };
  }),
);

export const wm2026Template: AlbumTemplate = {
  formatVersion: 1,
  album: {
    id: wm2026AlbumId,
    slug: "panini-world-cup-2026",
    title: "Panini FIFA World Cup 2026",
    description: "994 stickers · 48 teams · tournament and sponsor sections",
  },
  revision: {
    id: wm2026RevisionId,
    number: 1,
    label: "2026 checklist edition",
    status: "published",
  },
  sections,
  stickers,
};
