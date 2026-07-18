import { wm2026Template } from "@/data/wm2026";
import { closeDatabasePool } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";

async function main(): Promise<void> {
  try {
    const result = await seedAlbumTemplate(wm2026Template);
    console.info(
      result.created
        ? `Created ${wm2026Template.album.title}: ${result.sections} sections and ${result.stickers} stickers.`
        : `${wm2026Template.album.title} revision ${wm2026Template.revision.number} already exists; nothing was overwritten.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "World Cup 2026 catalog seed failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
