import Constants from 'expo-constants';
import { EventStore } from '../lib/eventStore';
import { sha256 } from '../platform/crypto';
import { createFieldReader } from '../platform/fieldReader';
import { expoLocation } from '../platform/location';
import { openExpoDb } from '../platform/sqlite';
import { expoSpeech } from '../platform/speech';
import { createWatchPort } from '../platform/watch';
import { DriverController } from './controller';

/** Builds the production controller: SQLite store (expo-sqlite), real clock, expo-speech, expo-location. */
export async function createProductionController(): Promise<DriverController> {
  const store = new EventStore(await openExpoDb(), sha256);
  await store.init();
  const controller = new DriverController({
    store,
    clock: () => Date.now(),
    speech: expoSpeech,
    location: expoLocation,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    fieldReader: createFieldReader(),
    watch: createWatchPort(),
  });
  await controller.load();
  return controller;
}
