import { euro2024Template } from "@/data/euro2024";
import { closeDatabasePool } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";

async function main(): Promise<void> {
  try {
    const result = await seedAlbumTemplate(euro2024Template);
    console.info(
      result.created
        ? `Created ${euro2024Template.album.title}: ${result.sections} sections and ${result.stickers} stickers.`
        : `${euro2024Template.album.title} revision ${euro2024Template.revision.number} already exists; nothing was overwritten.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "UEFA EURO 2024 catalog seed failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
