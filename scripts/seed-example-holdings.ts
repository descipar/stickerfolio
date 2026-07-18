import { wm2026ExampleHoldings } from "@/data/examples/wm2026-example-holdings";
import { closeDatabasePool } from "@/infrastructure/database";
import { seedExampleHoldings, type ExampleHoldingsDataset } from "@/modules/collections";

const datasets: Record<string, ExampleHoldingsDataset> = {
  [wm2026ExampleHoldings.id]: wm2026ExampleHoldings,
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

async function main(): Promise<void> {
  const collectorId = argument("--collector");
  const datasetId = argument("--dataset");
  if (!collectorId || !datasetId) {
    console.error("Usage: seed:example-holdings -- --collector <profile-uuid> --dataset <dataset-id>");
    process.exitCode = 2;
    return;
  }
  const dataset = datasets[datasetId];
  if (!dataset) {
    console.error(`Unknown example dataset: ${datasetId}`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = await seedExampleHoldings(collectorId, dataset);
    console.info(
      `Example holdings ${dataset.id}: inserted ${result.inserted}, skipped ${result.skipped}; collection ${result.collectionId}${result.collectionCreated ? " created" : " reused"}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Example holdings seed failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
