import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Importing a sample into the project library (the Library panel "Samples"
 * section): the file is stored content-addressed, added as an asset record, and
 * survives a reload. Fixture-driven with a tiny generated WAV - no mic, no real
 * audio file on disk.
 */

test.use({ viewport: { width: 1320, height: 900 } });

/** A minimal valid 16-bit PCM mono WAV (a few silent frames) as a Buffer. */
function tinyWav(): Buffer {
  const frames = 64;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  return buffer;
}

const sampleRow = (page: Page) => page.getByTitle('Add a Sampler track playing "blip"');

test("import a sample, it lists, and persists across reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Samples" }).click(); // open the Samples rail view

  await expect(sampleRow(page)).toHaveCount(0);

  await page
    .getByTestId("sample-import-input")
    .setInputFiles({ name: "blip.wav", mimeType: "audio/wav", buffer: tinyWav() });

  await expect(sampleRow(page)).toBeVisible();

  // The library is part of the persisted project: it survives a reload.
  await page.waitForTimeout(400); // let the debounced autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(sampleRow(page)).toBeVisible();
});

test("an audio clip becomes a sample: a library entry for the same audio, and a Sampler playing it", async ({
  page,
}) => {
  await page.goto("/");
  await dismissStart(page);
  await page
    .getByTestId("audio-import-input")
    .setInputFiles({ name: "take.wav", mimeType: "audio/wav", buffer: tinyWav() });
  await page.getByRole("button", { name: "Use as sample" }).click();

  // A Sampler track, set to the new library entry.
  await expect(page.getByText("sampler", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Samples" }).click();
  await expect(page.getByTitle('Add a Sampler track playing "take"')).toBeVisible();

  // The same audio again is the same library entry, not a second copy.
  await page.getByTitle("take (double-click to rename)").click();
  await page.getByRole("button", { name: "Use as sample" }).click();
  await expect(page.getByTitle('Add a Sampler track playing "take"')).toHaveCount(1);
});
