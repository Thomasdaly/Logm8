import { base64ToBytes } from '@logm8/diary-reader';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PhotoResult = { ok: true; jpeg: Uint8Array } | { ok: false; reason: 'cancelled' | 'denied' | 'failed'; message: string };

/** Longest side of the photo passed to the reader (enough for the 15-minute grid, small enough to process on a phone). */
export const PHOTO_MAX_SIDE = 1600;

/**
 * Takes (or picks) a photo of a daily sheet and returns it as JPEG bytes, resized so its longest side is
 * PHOTO_MAX_SIDE. The photo stays on the device; only small field crops are ever sent to the server.
 */
export async function getSheetPhoto(source: 'camera' | 'library'): Promise<PhotoResult> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied', message: 'Camera permission is needed to photograph your diary sheet. You can choose a photo instead.' };
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset) return { ok: false, reason: 'cancelled', message: 'No photo taken.' };
    const landscape = asset.width >= asset.height;
    const resize = landscape ? { width: Math.min(PHOTO_MAX_SIDE, asset.width) } : { height: Math.min(PHOTO_MAX_SIDE, asset.height) };
    const out = await ImageManipulator.manipulateAsync(asset.uri, [{ resize }], { base64: true, compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
    if (!out.base64) return { ok: false, reason: 'failed', message: 'Could not read the photo.' };
    return { ok: true, jpeg: base64ToBytes(out.base64) };
  } catch (e) {
    return { ok: false, reason: 'failed', message: `Could not get the photo: ${(e as Error).message}` };
  }
}
