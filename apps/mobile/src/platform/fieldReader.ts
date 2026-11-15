import { HttpFieldReader, NullFieldReader, type FieldReader } from '@logm8/diary-reader';

/**
 * The handwriting reader: the LogM8 server endpoint (which holds the vision-model credentials), configured with
 * EXPO_PUBLIC_FIELD_READER_URL. No API keys are ever bundled in the app. Without a URL, handwriting is not read
 * (the grid, checkboxes and missing fields are still checked on the phone).
 */
export function createFieldReader(url: string | undefined = process.env.EXPO_PUBLIC_FIELD_READER_URL): FieldReader {
  if (!url || !/^https?:\/\//.test(url)) return new NullFieldReader();
  return new HttpFieldReader({ endpoint: url, timeoutMs: 20_000 });
}
