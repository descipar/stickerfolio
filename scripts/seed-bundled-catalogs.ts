import { euro2024Template } from "@/data/euro2024";
import { wm2026Template } from "@/data/wm2026";
import { closeDatabasePool } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";

const templates = [wm2026Template, euro2024Template];

async function main(): Promise<void> {
  try {
    for (const template of templates) {
      const result = await seedAlbumTemplate(template);
      console.info(
        result.created
          ? `Created ${template.album.title}: ${result.sections} sections and ${result.stickers} stickers.`
          : `${template.album.title} revision ${template.revision.number} already exists; nothing was overwritten.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bundled catalog seed failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
